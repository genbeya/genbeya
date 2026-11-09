/**
 * Reads a repository on GitHub from a web page, through GitHub's REST API: the repository, the commit a
 * branch points to and its whole tree, in three requests ({@link readGitHubTree}); then the contents of
 * the files the caller chooses ({@link readGitHubFiles}).
 *
 * Without a token, contents come from raw.githubusercontent.com, which answers any origin and does not count
 * against the API's limit of 60 requests an hour without signing in; a public repository then costs three API
 * requests. With a token (private repositories), contents come from the API's blobs, one request per file.
 * Requests without a token carry no headers beyond the browser's own, so browsers send them without a preflight.
 */
import { isBranchName, isOwnerName, isRepositoryName } from "../../utilities/github-address";
import { validateRepositoryPath } from "../../utilities/repository-path";

export type Fetch = (url: string, init?: { readonly headers?: Record<string, string>; readonly signal?: AbortSignal }) => Promise<Response>;

/** A repository on github.com and, optionally, the branch to read; its default branch otherwise. */
export interface GitHubTarget {
  readonly owner: string;
  readonly name: string;
  readonly branch?: string;
}

export interface GitHubAccess {
  readonly fetch: Fetch;
  /** A token that may read the repository; needed for private repositories. Kept by the caller, sent only to api.github.com. */
  readonly token?: string;
  /** Files read at the same time. */
  readonly concurrency?: number;
  /** Called as files arrive: how many are read, of how many. */
  readonly progress?: (read: number, total: number) => void;
  readonly signal?: AbortSignal;
}

export interface GitHubPerson {
  readonly name: string;
  readonly email: string;
  /** ISO 8601, as GitHub gives it. */
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
  readonly sha: string;
  readonly size: number;
}

/** A branch of a repository on GitHub, as its tree lists it. */
export interface GitHubTree {
  /** As GitHub spells them, which may differ in case from the address. */
  readonly owner: string;
  readonly name: string;
  readonly private: boolean;
  /** The repository's page on github.com. */
  readonly webUrl: string;
  /** What `git clone` takes. */
  readonly cloneUrl: string;
  readonly defaultBranch: string;
  /** The branch that was read. */
  readonly branch: string;
  readonly commit: {
    readonly sha: string;
    readonly message: string;
    readonly author: GitHubPerson;
    readonly committer: GitHubPerson;
  };
  /** The files that can be read, sorted by path. */
  readonly files: readonly TreeFile[];
  readonly skipped: readonly SkippedFile[];
  /** True when GitHub's tree listing was cut short, so files beyond it are missing without being listed. */
  readonly truncated: boolean;
}

export const API = "https://api.github.com";
export const RAW = "https://raw.githubusercontent.com";

/** Larger files are left out: they are rarely what a board or a wiki needs, and each costs its size in the page's memory. */
export const MAX_FILE_BYTES = 1_000_000;

interface RepositoryResponse {
  readonly name: string;
  readonly owner: { readonly login: string };
  readonly private: boolean;
  readonly html_url: string;
  readonly clone_url: string;
  readonly default_branch: string;
}

interface CommitResponse {
  readonly sha: string;
  readonly commit: {
    readonly message: string;
    readonly author: GitHubPerson | null;
    readonly committer: GitHubPerson | null;
    readonly tree: { readonly sha: string };
  };
}

interface TreeResponse {
  readonly truncated: boolean;
  readonly tree: readonly {
    readonly path: string;
    readonly mode: string;
    readonly type: string;
    readonly sha: string;
    readonly size?: number;
  }[];
}

const SHA = /^[\da-f]{40}$/;

/** Lists `target`'s branch as it is now: three requests to the API. */
export async function readGitHubTree(target: GitHubTarget, access: GitHubAccess): Promise<GitHubTree> {
  if (!isOwnerName(target.owner) || !isRepositoryName(target.name)) throw new Error("That isn't a GitHub repository name.");
  if (target.branch !== undefined && !isBranchName(target.branch)) throw new Error("That isn't a branch name.");
  const label = `${target.owner}/${target.name}`;
  const api = new Api(access, label);
  const base = `${API}/repos/${target.owner}/${target.name}`;

  const repository = await api.json<RepositoryResponse>(base);
  const branch = target.branch ?? repository.default_branch;
  const commit = await api.json<CommitResponse>(
    `${base}/commits/${branch.split("/").map(encodeURIComponent).join("/")}`,
    `${label} has no branch ${branch}.`,
  );
  if (!SHA.test(commit.sha) || !SHA.test(commit.commit.tree.sha)) throw new Error("GitHub answered with something unexpected.");
  const tree = await api.json<TreeResponse>(`${base}/git/trees/${commit.commit.tree.sha}?recursive=1`);

  const skipped: SkippedFile[] = [];
  const files: TreeFile[] = [];
  for (const entry of tree.tree) {
    if (entry.type === "tree") continue;
    if (entry.type === "commit") skipped.push({ path: entry.path, reason: "submodule" });
    else if (entry.mode === "120000") skipped.push({ path: entry.path, reason: "link" });
    else if (entry.type !== "blob" || !SHA.test(entry.sha) || !safePath(entry.path)) skipped.push({ path: entry.path, reason: "path" });
    else if ((entry.size ?? 0) > MAX_FILE_BYTES) skipped.push({ path: entry.path, reason: "large" });
    else files.push({ path: entry.path, sha: entry.sha, size: entry.size ?? 0 });
  }
  const byPath = (a: { path: string }, b: { path: string }) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const someone = (person: GitHubPerson | null): GitHubPerson => person ?? { name: "Unknown", email: "", date: new Date(0).toISOString() };
  return {
    owner: repository.owner.login,
    name: repository.name,
    private: repository.private,
    webUrl: repository.html_url,
    cloneUrl: repository.clone_url,
    defaultBranch: repository.default_branch,
    branch,
    commit: {
      sha: commit.sha,
      message: commit.commit.message,
      author: someone(commit.commit.author),
      committer: someone(commit.commit.committer),
    },
    files: files.sort(byPath),
    skipped: skipped.sort(byPath),
    truncated: tree.truncated,
  };
}

/** The contents of `files` of `tree`, by path. */
export async function readGitHubFiles(
  tree: GitHubTree,
  files: readonly TreeFile[],
  access: GitHubAccess,
): Promise<Map<string, Uint8Array>> {
  const api = new Api(access, `${tree.owner}/${tree.name}`);
  const read = (file: TreeFile) =>
    access.token
      ? api.bytes(`${API}/repos/${tree.owner}/${tree.name}/git/blobs/${file.sha}`, "application/vnd.github.raw+json")
      : api.bytes(`${RAW}/${tree.owner}/${tree.name}/${tree.commit.sha}/${file.path.split("/").map(encodeURIComponent).join("/")}`);
  const contents = await inParallel(files, access.concurrency ?? 8, read, access.progress);
  return new Map(files.map((file, index) => [file.path, contents[index]!]));
}

function safePath(path: string): boolean {
  try {
    validateRepositoryPath(path, false);
    return path.length > 0;
  } catch {
    return false;
  }
}

/** GitHub's REST API and raw files, with errors a visitor can act on. */
class Api {
  constructor(
    private readonly access: GitHubAccess,
    private readonly label: string,
  ) {}

  async json<T>(url: string, notFound?: string): Promise<T> {
    const response = await this.request(url, "application/vnd.github+json", notFound);
    try {
      return (await response.json()) as T;
    } catch {
      throw new Error("GitHub answered with something unexpected.");
    }
  }

  async bytes(url: string, accept?: string): Promise<Uint8Array> {
    return new Uint8Array(await (await this.request(url, accept)).arrayBuffer());
  }

  private async request(url: string, accept?: string, notFound?: string): Promise<Response> {
    const toApi = url.startsWith(`${API}/`);
    const headers: Record<string, string> = {};
    // Only the API gets the token, and requests without one keep to headers that need no preflight.
    if (toApi && this.access.token) {
      headers["Authorization"] = `Bearer ${this.access.token}`;
      headers["X-GitHub-Api-Version"] = "2022-11-28";
    }
    if (accept && this.access.token) headers["Accept"] = accept;
    let response: Response;
    try {
      response = await this.access.fetch(url, { headers, signal: this.access.signal });
    } catch (error) {
      if (this.access.signal?.aborted) throw error;
      throw new Error("Can't reach GitHub. Check your connection and try again.", { cause: error });
    }
    if (response.ok) return response;
    throw new Error(this.problem(response, toApi, notFound));
  }

  private problem(response: Response, toApi: boolean, notFound?: string): string {
    const { status } = response;
    const remaining = response.headers.get("x-ratelimit-remaining");
    if (status === 429 && !toApi) return "GitHub is limiting how fast this page reads files. Try again in a few minutes.";
    if (status === 429 || (status === 403 && (remaining === "0" || response.headers.has("retry-after")))) {
      const reset = Number(response.headers.get("x-ratelimit-reset"));
      const until =
        Number.isFinite(reset) && reset > 0
          ? ` until ${new Date(reset * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
          : "";
      return this.access.token
        ? `GitHub's limit of requests for your token is used up${until}.`
        : `GitHub's limit of requests without signing in is used up${until}. A token raises it.`;
    }
    if (status === 401) return "GitHub didn't accept the token. Check that it is valid and hasn't expired.";
    // GitHub answers 422 for a branch it doesn't know.
    if (notFound && (status === 404 || status === 422)) return notFound;
    if (status === 404 || (status === 403 && !toApi))
      return this.access.token
        ? `GitHub has no repository ${this.label} that your token can read.`
        : `GitHub has no public repository ${this.label}. A private one opens with a token that can read it.`;
    if (status === 403) return `GitHub refused to show ${this.label}${this.access.token ? " to your token" : ""}.`;
    return `GitHub answered ${status} for ${this.label}. Try again later.`;
  }
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
