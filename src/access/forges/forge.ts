/**
 * Reading a repository on a forge from a web page, whichever forge: a reader lists a branch ({@link
 * ForgeReader.readTree}) and reads the files the caller chooses ({@link ForgeReader.readFiles}), through the
 * forge's API, with errors a visitor can act on. Every forge answers web pages from any origin; Git's own
 * protocol doesn't, which is why there is no Git here. `fetch` is injected.
 */
import { FORGE_LABELS, isBranchName, isRepository, type ForgeAddress } from "../../utilities/forge-address";
import { validateRepositoryPath } from "../../utilities/repository-path";

export type Fetch = (url: string, init?: { readonly headers?: Record<string, string>; readonly signal?: AbortSignal }) => Promise<Response>;

export interface ForgeAccess {
  readonly fetch: Fetch;
  /** A token that may read the repository; needed for private repositories. Kept by the caller, sent only to the forge's API. */
  readonly token?: string;
  /** Files read at the same time. */
  readonly concurrency?: number;
  /** Called as files arrive: how many are read, of how many. */
  readonly progress?: (read: number, total: number) => void;
  readonly signal?: AbortSignal;
}

export interface ForgePerson {
  readonly name: string;
  readonly email: string;
  /** ISO 8601, as the forge gives it. */
  readonly date: string;
}

/** An entry of the tree that can't be read as a file, and why. */
export interface SkippedFile {
  readonly path: string;
  readonly reason: "large" | "link" | "submodule" | "path";
}

/** A file of the tree that can be read. */
export interface TreeFile {
  readonly path: string;
  /** What the forge reads the file by: its blob ID, or its path. */
  readonly id: string;
  /** In bytes; 0 where the forge doesn't list sizes (GitLab). */
  readonly size: number;
}

/** A branch of a repository on a forge, as its tree lists it. */
export interface ForgeTree {
  readonly address: ForgeAddress;
  /** As the forge spells them, which may differ in case from the address. */
  readonly owner: string;
  readonly name: string;
  readonly private: boolean;
  /** The repository's page on the forge's website. */
  readonly webUrl: string;
  /** What `git clone` takes. */
  readonly cloneUrl: string;
  readonly defaultBranch: string;
  /** The branch that was read. */
  readonly branch: string;
  readonly commit: {
    readonly sha: string;
    readonly message: string;
    readonly author: ForgePerson;
    readonly committer: ForgePerson;
  };
  /** The files that can be read, sorted by path. */
  readonly files: readonly TreeFile[];
  readonly skipped: readonly SkippedFile[];
  /** True when the forge listed only part of the tree, so files beyond it are missing without being listed. */
  readonly truncated: boolean;
}

export interface ForgeReader {
  /** Lists the branch as it is now. */
  readTree(address: ForgeAddress, access: ForgeAccess): Promise<ForgeTree>;
  /** The contents of `files` of `tree`, by path; files over {@link MAX_FILE_BYTES} are left out. */
  readFiles(tree: ForgeTree, files: readonly TreeFile[], access: ForgeAccess): Promise<Map<string, Uint8Array>>;
}

/** Larger files are left out: they are rarely what a board or a wiki needs, and each costs its size in the page's memory. */
export const MAX_FILE_BYTES = 1_000_000;
/** Pages of a tree listing a reader follows at most; a tree beyond them is truncated. */
export const MAX_TREE_PAGES = 100;

/** A commit ID: SHA-1, or SHA-256 for repositories that use it. */
export const COMMIT_ID = /^(?:[\da-f]{40}|[\da-f]{64})$/;

/** Throws unless `address` names a repository and branch its forge allows, before anything is requested. */
export function checkAddress(address: ForgeAddress): void {
  if (!isRepository(address.forge, address.owner, address.name))
    throw new Error(`That isn't a ${FORGE_LABELS[address.forge]} repository name.`);
  if (address.branch !== undefined && !isBranchName(address.branch)) throw new Error("That isn't a branch name.");
}

/** Whether a path of the tree is one Genbeya can hold. */
export function safePath(path: string): boolean {
  try {
    validateRepositoryPath(path, false);
    return path.length > 0;
  } catch {
    return false;
  }
}

export const byPath = (a: { path: string }, b: { path: string }): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** `path` with each of its segments percent-encoded. */
export const encodePath = (path: string): string => path.split("/").map(encodeURIComponent).join("/");

export const nobody: ForgePerson = { name: "Unknown", email: "", date: new Date(0).toISOString() };

/** "Ada Lovelace <ada@example.com>" as name and email. */
export function parsePerson(raw: string | undefined, date: string): ForgePerson {
  const match = /^(.*?)\s*<([^>]*)>\s*$/.exec(raw ?? "");
  return match ? { name: match[1] || "Unknown", email: match[2]!, date } : { name: raw?.trim() || "Unknown", email: "", date };
}

export interface ApiOptions {
  /** URLs that start with this are the API, which alone gets the token. */
  readonly api: string;
  /** The header that carries the token. */
  readonly authorization: (token: string) => Record<string, string>;
}

/** A forge's API, and raw files elsewhere where the forge has them, with errors a visitor can act on. */
export class Api {
  /** The forge's name, for messages. */
  readonly forge: string;
  private readonly label: string;

  constructor(
    address: ForgeAddress,
    private readonly access: ForgeAccess,
    private readonly options: ApiOptions,
  ) {
    this.forge = FORGE_LABELS[address.forge];
    this.label = `${address.owner}/${address.name}`;
  }

  async json<T>(url: string, notFound?: string): Promise<{ readonly value: T; readonly response: Response }> {
    const response = await this.request(url, notFound);
    try {
      return { value: (await response.json()) as T, response };
    } catch {
      throw new Error(`${this.forge} answered with something unexpected.`);
    }
  }

  async bytes(url: string, accept?: string): Promise<Uint8Array> {
    return new Uint8Array(await (await this.request(url, undefined, accept)).arrayBuffer());
  }

  /** Reads `files`, a few at a time, leaving out those over {@link MAX_FILE_BYTES}. */
  async files(files: readonly TreeFile[], url: (file: TreeFile) => string, accept?: string): Promise<Map<string, Uint8Array>> {
    const contents = await inParallel(files, this.access.concurrency ?? 8, (file) => this.bytes(url(file), accept), this.access.progress);
    return new Map(
      files.flatMap((file, index) => (contents[index]!.length > MAX_FILE_BYTES ? [] : [[file.path, contents[index]!] as const])),
    );
  }

  /** Whether `url` is the API's, so a page link from a response may be followed. */
  isApi(url: string): boolean {
    return url.startsWith(this.options.api);
  }

  /**
   * The next page a response links to, relative to the page that linked it. A server behind a proxy that
   * ends TLS may believe it is reached over http (GitLab's `external_url`) and link its own API that way:
   * such a link, to the API's own host and path, is followed over https. A link anywhere else is refused.
   */
  nextPage(link: string, from: string): string {
    let next: URL;
    try {
      next = new URL(link, from);
    } catch {
      throw new Error(`${this.forge} linked to a next page Genbeya can't read: ${link}`);
    }
    const api = new URL(this.options.api);
    if (next.protocol === "http:" && api.protocol === "https:" && next.host === api.host) next.protocol = "https:";
    if (!this.isApi(next.href))
      throw new Error(`${this.forge} linked to a next page outside its API, which Genbeya doesn't follow: ${next.origin}${next.pathname}`);
    return next.href;
  }

  private async request(url: string, notFound?: string, accept?: string): Promise<Response> {
    const toApi = this.isApi(url);
    // Only the API gets the token, and requests without one keep to headers that need no preflight.
    const headers: Record<string, string> = toApi && this.access.token ? this.options.authorization(this.access.token) : {};
    if (accept && this.access.token) headers["Accept"] = accept;
    let response: Response;
    try {
      response = await this.access.fetch(url, { headers, signal: this.access.signal });
    } catch (error) {
      if (this.access.signal?.aborted) throw error;
      throw new Error(`Can't reach ${this.forge}. Check your connection and try again.`, { cause: error });
    }
    if (response.ok) return response;
    throw new Error(this.problem(response, toApi, notFound));
  }

  private problem(response: Response, toApi: boolean, notFound?: string): string {
    const { status } = response;
    const { forge, label } = this;
    const remaining = response.headers.get("x-ratelimit-remaining") ?? response.headers.get("ratelimit-remaining");
    if (status === 429 && !toApi) return `${forge} is limiting how fast this page reads files. Try again in a few minutes.`;
    if (status === 429 || (status === 403 && (remaining === "0" || response.headers.has("retry-after")))) {
      const reset = Number(response.headers.get("x-ratelimit-reset") ?? response.headers.get("ratelimit-reset"));
      const until =
        Number.isFinite(reset) && reset > 0
          ? ` until ${new Date(reset * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
          : "";
      return this.access.token
        ? `${forge}'s limit of requests for your token is used up${until}.`
        : `${forge}'s limit of requests without signing in is used up${until}. A token raises it.`;
    }
    if (status === 401) return `${forge} didn't accept the token. Check that it is valid and hasn't expired.`;
    // GitHub answers 422 for a branch it doesn't know.
    if (notFound && (status === 404 || status === 422)) return notFound;
    if (status === 404 || (status === 403 && !toApi))
      return this.access.token
        ? `${forge} has no repository ${label} that your token can read.`
        : `${forge} has no public repository ${label}. A private one opens with a token that can read it.`;
    if (status === 403) return `${forge} refused to show ${label}${this.access.token ? " to your token" : ""}.`;
    return `${forge} answered ${status} for ${label}. Try again later.`;
  }
}

/** Follows a listing's pages: `page` reads one and says where the next is, if anywhere. */
export async function allPages<T>(
  first: string,
  api: Api,
  page: (url: string) => Promise<{ items: T[]; next: string | null }>,
): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];
  let url: string | null = first;
  for (let count = 0; url; count++) {
    if (count === MAX_TREE_PAGES) return { items, truncated: true };
    const result: { items: T[]; next: string | null } = await page(url);
    items.push(...result.items);
    // A next page elsewhere than the API is never followed.
    url = result.next === null ? null : api.nextPage(result.next, url);
  }
  return { items, truncated: false };
}

/**
 * `url` over https when it is an http address on `host`, which the page was just reached on over https: a
 * self-hosted forge behind a proxy that ends TLS may name its own pages with http. Anything else as it is.
 */
export function upgraded(url: string, host: string): string {
  return url.toLowerCase().startsWith(`http://${host.toLowerCase()}/`) ? `https://${url.slice("http://".length)}` : url;
}

/** The `rel="next"` link of a response's `Link` header. */
export function nextLink(response: Response): string | null {
  return /<([^>]+)>;\s*rel="next"/.exec(response.headers.get("link") ?? "")?.[1] ?? null;
}

/** Runs `work` on every item, `limit` at a time, keeping their order; fails on the first failure. */
async function inParallel<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
  progress?: (done: number, total: number) => void,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let done = 0;
  progress?.(0, items.length);
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]!);
      progress?.(++done, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}
