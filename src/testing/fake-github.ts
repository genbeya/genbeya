/**
 * GitHub's REST API and raw.githubusercontent.com as far as the GitHub reader uses them, answering from
 * repositories in memory: public and private ones, tokens, and the limit of requests without one.
 */
import type { Fetch } from "../access/github/github-reader";

export interface FakeCommit {
  readonly files: Readonly<Record<string, string | Uint8Array>>;
  readonly message?: string;
  readonly author?: { readonly name: string; readonly email: string; readonly date: string };
}

export interface FakeRepository {
  readonly owner: string;
  readonly name: string;
  readonly private?: boolean;
  readonly defaultBranch?: string;
  readonly branches: Readonly<Record<string, FakeCommit>>;
  /** Paths listed as submodules or symbolic links rather than files. */
  readonly submodules?: readonly string[];
  readonly links?: readonly string[];
  /** Files GitHub lists with this size instead of their own. */
  readonly sizes?: Readonly<Record<string, number>>;
}

export interface FakeGitHubOptions {
  /** The token that may read private repositories. */
  readonly token?: string;
  /** Tokens GitHub accepts that may not read them. */
  readonly otherTokens?: readonly string[];
  /** Requests to the API without a token left this hour. */
  readonly anonymousLimit?: number;
}

export interface FakeRequest {
  readonly url: string;
  /** By lower-case name. */
  readonly headers: Readonly<Record<string, string>>;
}

export type FakeGitHub = Fetch & { readonly requests: FakeRequest[] };

const API = "https://api.github.com/";
const RAW = "https://raw.githubusercontent.com/";
const RESET = 1_900_000_000;

export function fakeGitHub(repositories: readonly FakeRepository[], options: FakeGitHubOptions = {}): FakeGitHub {
  const requests: FakeRequest[] = [];
  let anonymousLeft = options.anonymousLimit ?? 60;
  const ids = new Map<string, string>();
  const id = (key: string) => {
    if (!ids.has(key)) ids.set(key, (ids.size + 1).toString(16).padStart(40, "0"));
    return ids.get(key)!;
  };
  const blobs = new Map<string, Uint8Array>();

  const find = (owner: string, name: string) =>
    repositories.find(
      (repository) => repository.owner.toLowerCase() === owner.toLowerCase() && repository.name.toLowerCase() === name.toLowerCase(),
    );

  const fetch = async (url: string, init?: { readonly headers?: Record<string, string> }): Promise<Response> => {
    // Header names are case-insensitive; browsers send them lower-cased.
    const headers = Object.fromEntries(Object.entries(init?.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
    requests.push({ url, headers: { ...headers } });
    const token = /^Bearer (.+)$/.exec(headers["authorization"] ?? "")?.[1];
    const authorized = token !== undefined && token === options.token;
    if (url.startsWith(RAW)) {
      const [owner = "", name = "", sha = "", ...path] = url.slice(RAW.length).split("/");
      const repository = find(owner, name);
      const branch =
        repository && Object.entries(repository.branches).find(([branchName]) => id(`commit:${repository.name}:${branchName}`) === sha);
      const content = branch?.[1].files[path.map(decodeURIComponent).join("/")];
      if (!repository || repository.private || content === undefined) return text(404, "404: Not Found");
      return bytes(content);
    }
    if (!url.startsWith(API)) throw new TypeError("Failed to fetch");
    if (token !== undefined && !authorized && !options.otherTokens?.includes(token)) return json(401, { message: "Bad credentials" });
    if (token === undefined && anonymousLeft-- <= 0)
      return json(403, { message: "API rate limit exceeded" }, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(RESET) });
    const [path = "", query = ""] = url.slice(API.length).split("?");
    const [, owner = "", name = "", ...rest] = path.split("/");
    const repository = find(owner, name);
    if (!repository || (repository.private && !authorized)) return json(404, { message: "Not Found" });
    const defaultBranch = repository.defaultBranch ?? Object.keys(repository.branches)[0]!;
    if (!rest.length)
      return json(200, {
        name: repository.name,
        owner: { login: repository.owner },
        private: !!repository.private,
        html_url: `https://github.com/${repository.owner}/${repository.name}`,
        clone_url: `https://github.com/${repository.owner}/${repository.name}.git`,
        default_branch: defaultBranch,
      });
    if (rest[0] === "commits") {
      const branchName = rest.slice(1).map(decodeURIComponent).join("/");
      const commit = repository.branches[branchName];
      if (!commit) return json(422, { message: `No commit found for SHA: ${branchName}` });
      const author = commit.author ?? { name: "Ada Lovelace", email: "ada@example.com", date: "2026-11-01T10:00:00Z" };
      return json(200, {
        sha: id(`commit:${repository.name}:${branchName}`),
        commit: {
          message: commit.message ?? "Latest",
          author,
          committer: author,
          tree: { sha: id(`tree:${repository.name}:${branchName}`) },
        },
      });
    }
    if (rest[0] === "git" && rest[1] === "trees") {
      const branch = Object.entries(repository.branches).find(([branchName]) => id(`tree:${repository.name}:${branchName}`) === rest[2]);
      if (!branch || query !== "recursive=1") return json(404, { message: "Not Found" });
      const tree: object[] = [];
      for (const [file, content] of Object.entries(branch[1].files)) {
        const data = typeof content === "string" ? new TextEncoder().encode(content) : content;
        const sha = id(`blob:${repository.name}:${branch[0]}:${file}`);
        blobs.set(sha, data);
        const mode = repository.links?.includes(file) ? "120000" : "100644";
        tree.push({ path: file, mode, type: "blob", sha, size: repository.sizes?.[file] ?? data.length });
      }
      for (const submodule of repository.submodules ?? [])
        tree.push({ path: submodule, mode: "160000", type: "commit", sha: id(`sub:${submodule}`) });
      return json(200, { sha: rest[2], truncated: false, tree });
    }
    if (rest[0] === "git" && rest[1] === "blobs") {
      const data = blobs.get(rest[2] ?? "");
      if (!data) return json(404, { message: "Not Found" });
      if (headers["accept"] !== "application/vnd.github.raw+json") return json(200, { encoding: "base64" });
      return bytes(data);
    }
    return json(404, { message: "Not Found" });
  };
  return Object.assign(fetch, { requests });
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const text = (status: number, body: string) => new Response(body, { status });
const bytes = (content: string | Uint8Array) =>
  new Response(typeof content === "string" ? new TextEncoder().encode(content) : new Uint8Array(content), { status: 200 });
