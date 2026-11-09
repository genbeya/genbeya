/**
 * The forges' APIs as far as the readers use them, answering from repositories in memory: GitHub (its API
 * and raw.githubusercontent.com), GitLab, Gitea and Forgejo (Codeberg's), and Bitbucket Cloud, on their
 * websites or servers of their own. Public and private repositories, tokens, listings in pages, and GitHub's
 * limit of requests without a token. Requests to any other host fail, as a browser's would.
 */
import type { Fetch } from "../access/forges/forge";
import { FORGE_HOSTS, type Forge } from "../utilities/forge-address";

export interface FakeCommit {
  readonly files: Readonly<Record<string, string | Uint8Array>>;
  readonly message?: string;
  readonly author?: { readonly name: string; readonly email: string; readonly date: string };
}

export interface FakeRepository {
  /** GitHub unless given. */
  readonly forge?: Forge;
  /** The forge's website unless given; needed for Gitea and Forgejo. */
  readonly host?: string;
  readonly owner: string;
  readonly name: string;
  readonly private?: boolean;
  readonly defaultBranch?: string;
  readonly branches: Readonly<Record<string, FakeCommit>>;
  /** Paths listed as submodules or symbolic links rather than files. */
  readonly submodules?: readonly string[];
  readonly links?: readonly string[];
  /** Files listed with this size instead of their own. */
  readonly sizes?: Readonly<Record<string, number>>;
}

export interface FakeForgeOptions {
  /** The token that may read private repositories. */
  readonly token?: string;
  /** Tokens the forges accept that may not read them. */
  readonly otherTokens?: readonly string[];
  /** Requests to GitHub's API without a token left this hour. */
  readonly anonymousLimit?: number;
  /** Entries per page of a tree listing, small so the readers follow pages. */
  readonly pageSize?: number;
}

export interface FakeRequest {
  readonly url: string;
  /** By lower-case name. */
  readonly headers: Readonly<Record<string, string>>;
}

export type FakeForges = Fetch & { readonly requests: FakeRequest[] };

const RESET = 1_900_000_000;
const AUTHOR = { name: "Ada Lovelace", email: "ada@example.com", date: "2026-11-01T10:00:00Z" };

interface Entry {
  readonly path: string;
  readonly kind: "file" | "folder" | "link" | "submodule";
  readonly data?: Uint8Array;
  readonly size: number;
  readonly id: string;
}

export function fakeForges(repositories: readonly FakeRepository[], options: FakeForgeOptions = {}): FakeForges {
  const requests: FakeRequest[] = [];
  const pageSize = options.pageSize ?? 3;
  let anonymousLeft = options.anonymousLimit ?? 60;
  const ids = new Map<string, string>();
  const id = (key: string) => {
    if (!ids.has(key)) ids.set(key, (ids.size + 1).toString(16).padStart(40, "0"));
    return ids.get(key)!;
  };
  const forgeOf = (repository: FakeRepository) => repository.forge ?? "github";
  const hostOf = (repository: FakeRepository) => repository.host ?? FORGE_HOSTS[forgeOf(repository)]!;
  const keyOf = (repository: FakeRepository) => `${hostOf(repository)}/${repository.owner}/${repository.name}`;
  const commitId = (repository: FakeRepository, branch: string) => id(`commit:${keyOf(repository)}:${branch}`);
  const defaultBranch = (repository: FakeRepository) => repository.defaultBranch ?? Object.keys(repository.branches)[0]!;
  const find = (forges: readonly Forge[], host: string, owner: string, name: string) =>
    repositories.find(
      (repository) =>
        forges.includes(forgeOf(repository)) &&
        hostOf(repository) === host &&
        repository.owner.toLowerCase() === owner.toLowerCase() &&
        repository.name.toLowerCase() === name.toLowerCase(),
    );
  const byCommit = (repository: FakeRepository, sha: string) =>
    Object.entries(repository.branches).find(
      ([branch]) => commitId(repository, branch) === sha || id(`tree:${keyOf(repository)}:${branch}`) === sha,
    );

  /** Files, links, submodules and the folders that hold them, sorted by path. */
  const entries = (repository: FakeRepository, branch: string, commit: FakeCommit): Entry[] => {
    const list = new Map<string, Entry>();
    const add = (path: string, kind: Entry["kind"], data?: Uint8Array) => {
      const parts = path.split("/");
      for (let depth = 1; depth < parts.length; depth++) {
        const folder = parts.slice(0, depth).join("/");
        list.set(folder, { path: folder, kind: "folder", size: 0, id: id(`folder:${keyOf(repository)}:${branch}:${folder}`) });
      }
      list.set(path, {
        path,
        kind,
        data,
        size: repository.sizes?.[path] ?? data?.length ?? 0,
        id: id(`blob:${keyOf(repository)}:${branch}:${path}`),
      });
    };
    for (const [path, content] of Object.entries(commit.files)) {
      const kind = repository.links?.includes(path) ? "link" : "file";
      add(path, kind, typeof content === "string" ? new TextEncoder().encode(content) : content);
    }
    for (const path of repository.submodules ?? []) add(path, "submodule");
    return [...list.values()].sort((a, b) => (a.path < b.path ? -1 : 1));
  };

  const fetch = async (url: string, init?: { readonly headers?: Record<string, string> }): Promise<Response> => {
    // Header names are case-insensitive; browsers send them lower-cased.
    const headers = Object.fromEntries(Object.entries(init?.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
    requests.push({ url, headers: { ...headers } });
    const token = /^(?:Bearer|token) (.+)$/.exec(headers["authorization"] ?? "")?.[1];
    const authorized = token !== undefined && token === options.token;
    const known = authorized || (token !== undefined && options.otherTokens?.includes(token));
    const parsed = new URL(url);
    const { host } = parsed;
    const path = parsed.pathname.split("/").map(decodeURIComponent);
    const visible = (repository: FakeRepository | undefined) =>
      repository && (!repository.private || authorized) ? repository : undefined;

    // GitHub's raw files: no token, public repositories only.
    if (host === "raw.githubusercontent.com") {
      const [, owner = "", name = "", sha = "", ...rest] = path;
      const repository = find(["github"], "github.com", owner, name);
      const branch = repository && byCommit(repository, sha);
      const content = branch?.[1].files[rest.join("/")];
      if (!repository || repository.private || content === undefined) return text(404, "404: Not Found");
      return bytes(content);
    }
    if (token !== undefined && !known) return json(401, { message: "Bad credentials" });

    if (host === "api.github.com") {
      if (token === undefined && anonymousLeft-- <= 0)
        return json(403, { message: "API rate limit exceeded" }, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(RESET) });
      const [, , owner = "", name = "", ...rest] = path;
      const repository = visible(find(["github"], "github.com", owner, name));
      if (!repository) return json(404, { message: "Not Found" });
      if (!rest.length)
        return json(200, {
          name: repository.name,
          owner: { login: repository.owner },
          private: !!repository.private,
          html_url: `https://github.com/${repository.owner}/${repository.name}`,
          clone_url: `https://github.com/${repository.owner}/${repository.name}.git`,
          default_branch: defaultBranch(repository),
        });
      if (rest[0] === "commits") {
        const branch = rest.slice(1).join("/");
        const commit = repository.branches[branch];
        if (!commit) return json(422, { message: `No commit found for SHA: ${branch}` });
        const author = commit.author ?? AUTHOR;
        return json(200, {
          sha: commitId(repository, branch),
          commit: {
            message: commit.message ?? "Latest",
            author,
            committer: author,
            tree: { sha: id(`tree:${keyOf(repository)}:${branch}`) },
          },
        });
      }
      if (rest[0] === "git" && rest[1] === "trees") {
        const branch = byCommit(repository, rest[2] ?? "");
        if (!branch || parsed.search !== "?recursive=1") return json(404, { message: "Not Found" });
        const tree = entries(repository, ...branch).map((entry) => ({
          path: entry.path,
          mode: entry.kind === "link" ? "120000" : entry.kind === "submodule" ? "160000" : entry.kind === "folder" ? "040000" : "100644",
          type: entry.kind === "submodule" ? "commit" : entry.kind === "folder" ? "tree" : "blob",
          sha: entry.id,
          ...(entry.kind === "folder" ? {} : { size: entry.size }),
        }));
        return json(200, { sha: rest[2], truncated: false, tree });
      }
      if (rest[0] === "git" && rest[1] === "blobs") {
        const entry = Object.entries(repository.branches)
          .flatMap(([branch, commit]) => entries(repository, branch, commit))
          .find((candidate) => candidate.id === rest[2] && candidate.data);
        if (!entry) return json(404, { message: "Not Found" });
        if (headers["accept"] !== "application/vnd.github.raw+json") return json(200, { encoding: "base64" });
        return bytes(entry.data!);
      }
      return json(404, { message: "Not Found" });
    }

    if (path[1] === "api" && path[2] === "v4" && path[3] === "projects") {
      const project = path[4] ?? "";
      const at = project.lastIndexOf("/");
      const repository = visible(find(["gitlab"], host, project.slice(0, at), project.slice(at + 1)));
      if (!repository) return json(404, { message: "404 Project Not Found" });
      const rest = path.slice(5);
      if (!rest.length)
        return json(200, {
          path_with_namespace: `${repository.owner}/${repository.name}`,
          visibility: repository.private ? "private" : "public",
          web_url: `https://${host}/${repository.owner}/${repository.name}`,
          http_url_to_repo: `https://${host}/${repository.owner}/${repository.name}.git`,
          default_branch: defaultBranch(repository),
        });
      if (rest[0] === "repository" && rest[1] === "branches") {
        const branch = rest.slice(2).join("/");
        const commit = repository.branches[branch];
        if (!commit) return json(404, { message: "404 Branch Not Found" });
        const author = commit.author ?? AUTHOR;
        return json(200, {
          name: branch,
          commit: {
            id: commitId(repository, branch),
            message: commit.message ?? "Latest",
            author_name: author.name,
            author_email: author.email,
            authored_date: author.date,
            committer_name: author.name,
            committer_email: author.email,
            committed_date: author.date,
          },
        });
      }
      if (rest[0] === "repository" && rest[1] === "tree") {
        const branch = byCommit(repository, parsed.searchParams.get("ref") ?? "");
        if (!branch || parsed.searchParams.get("recursive") !== "true") return json(404, { message: "404 Tree Not Found" });
        const all = entries(repository, ...branch).map((entry) => ({
          id: entry.id,
          name: entry.path.split("/").pop(),
          type: entry.kind === "submodule" ? "commit" : entry.kind === "folder" ? "tree" : "blob",
          path: entry.path,
          mode: entry.kind === "link" ? "120000" : entry.kind === "submodule" ? "160000" : entry.kind === "folder" ? "040000" : "100644",
        }));
        const start = Number(parsed.searchParams.get("page_token") ?? 0);
        const next = new URL(url);
        next.searchParams.set("page_token", String(start + pageSize));
        return json(200, all.slice(start, start + pageSize), start + pageSize < all.length ? { link: `<${next.href}>; rel="next"` } : {});
      }
      if (rest[0] === "repository" && rest[1] === "blobs" && rest[3] === "raw") {
        const entry = Object.entries(repository.branches)
          .flatMap(([branch, commit]) => entries(repository, branch, commit))
          .find((candidate) => candidate.id === rest[2] && candidate.data);
        return entry ? bytes(entry.data!) : json(404, { message: "404 Not Found" });
      }
      return json(404, { message: "404 Not Found" });
    }

    if (path[1] === "api" && path[2] === "v1" && path[3] === "repos") {
      const repository = visible(find(["gitea", "forgejo", "codeberg"], host, path[4] ?? "", path[5] ?? ""));
      if (!repository) return json(404, { message: "The target couldn't be found." });
      const rest = path.slice(6);
      if (!rest.length)
        return json(200, {
          name: repository.name,
          owner: { login: repository.owner },
          private: !!repository.private,
          html_url: `https://${host}/${repository.owner}/${repository.name}`,
          clone_url: `https://${host}/${repository.owner}/${repository.name}.git`,
          default_branch: defaultBranch(repository),
        });
      if (rest[0] === "branches") {
        const branch = rest.slice(1).join("/");
        const commit = repository.branches[branch];
        if (!commit) return json(404, { message: "Branch doesn't exist" });
        const author = commit.author ?? AUTHOR;
        const person = { name: author.name, email: author.email, username: "ada" };
        return json(200, {
          name: branch,
          commit: {
            id: commitId(repository, branch),
            message: commit.message ?? "Latest",
            author: person,
            committer: person,
            timestamp: author.date,
          },
        });
      }
      if (rest[0] === "git" && rest[1] === "trees") {
        const branch = byCommit(repository, rest[2] ?? "");
        if (!branch || parsed.searchParams.get("recursive") !== "true") return json(404, { message: "Not Found" });
        const all = entries(repository, ...branch).map((entry) => ({
          path: entry.path,
          mode: entry.kind === "link" ? "120000" : entry.kind === "submodule" ? "160000" : entry.kind === "folder" ? "040000" : "100644",
          type: entry.kind === "submodule" ? "commit" : entry.kind === "folder" ? "tree" : "blob",
          size: entry.size,
          sha: entry.id,
        }));
        const page = Number(parsed.searchParams.get("page") ?? 1);
        const tree = all.slice((page - 1) * pageSize, page * pageSize);
        return json(200, {
          sha: rest[2],
          tree: tree.length ? tree : null,
          truncated: page * pageSize < all.length,
          page,
          total_count: all.length,
        });
      }
      if (rest[0] === "raw") {
        const branch = byCommit(repository, parsed.searchParams.get("ref") ?? "");
        const content = branch?.[1].files[rest.slice(1).join("/")];
        return content === undefined ? json(404, { message: "Not Found" }) : bytes(content);
      }
      return json(404, { message: "Not Found" });
    }

    if (host === "api.bitbucket.org" && path[1] === "2.0" && path[2] === "repositories") {
      const repository = visible(find(["bitbucket"], "bitbucket.org", path[3] ?? "", path[4] ?? ""));
      if (!repository) return json(404, { type: "error", error: { message: "Repository not found" } });
      const rest = path.slice(5);
      if (!rest.length)
        return json(200, {
          full_name: `${repository.owner}/${repository.name}`,
          is_private: !!repository.private,
          mainbranch: { name: defaultBranch(repository), type: "branch" },
          links: {
            html: { href: `https://bitbucket.org/${repository.owner}/${repository.name}` },
            clone: [
              { name: "https", href: `https://ada@bitbucket.org/${repository.owner}/${repository.name}.git` },
              { name: "ssh", href: `git@bitbucket.org:${repository.owner}/${repository.name}.git` },
            ],
          },
        });
      if (rest[0] === "refs" && rest[1] === "branches") {
        const branch = rest.slice(2).join("/");
        const commit = repository.branches[branch];
        if (!commit) return json(404, { type: "error", error: { message: `Branch "${branch}" not found` } });
        const author = commit.author ?? AUTHOR;
        return json(200, {
          name: branch,
          target: {
            hash: commitId(repository, branch),
            message: commit.message ?? "Latest",
            date: author.date,
            author: { raw: `${author.name} <${author.email}>` },
          },
        });
      }
      if (rest[0] === "src") {
        const branch = byCommit(repository, rest[1] ?? "");
        if (!branch) return json(404, { type: "error", error: { message: "Commit not found" } });
        const filePath = rest.slice(2).join("/");
        if (filePath) {
          const content = branch[1].files[filePath];
          return content === undefined ? json(404, { type: "error" }) : bytes(content);
        }
        const values = entries(repository, ...branch).map((entry) =>
          entry.kind === "folder"
            ? { type: "commit_directory", path: entry.path }
            : {
                type: "commit_file",
                path: entry.path,
                size: entry.size,
                attributes: entry.kind === "link" ? ["link"] : entry.kind === "submodule" ? ["subrepository"] : [],
              },
        );
        const page = Number(parsed.searchParams.get("page") ?? 1);
        const next = new URL(url);
        next.searchParams.set("page", String(page + 1));
        return json(200, {
          values: values.slice((page - 1) * pageSize, page * pageSize),
          pagelen: pageSize,
          page,
          ...(page * pageSize < values.length ? { next: next.href } : {}),
        });
      }
      return json(404, { type: "error" });
    }

    throw new TypeError("Failed to fetch");
  };
  return Object.assign(fetch, { requests });
}

/** GitHub's part of {@link fakeForges}. */
export const fakeGitHub = fakeForges;
export type FakeGitHub = FakeForges;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const text = (status: number, body: string) => new Response(body, { status });
const bytes = (content: string | Uint8Array) =>
  new Response(typeof content === "string" ? new TextEncoder().encode(content) : new Uint8Array(content), { status: 200 });
