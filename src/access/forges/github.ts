/**
 * GitHub: the repository, the commit of the branch and its whole tree are three API requests. Without a
 * token, files come from raw.githubusercontent.com, which doesn't count against the API's limit of 60
 * requests an hour without signing in; with one, from the API's blobs, one request per file.
 */
import {
  Api,
  byPath,
  checkAddress,
  COMMIT_ID,
  encodePath,
  nobody,
  safePath,
  MAX_FILE_BYTES,
  type ForgePerson,
  type ForgeReader,
  type SkippedFile,
  type TreeFile,
} from "./forge";

export const API = "https://api.github.com";
export const RAW = "https://raw.githubusercontent.com";

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
    readonly author: ForgePerson | null;
    readonly committer: ForgePerson | null;
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

const api = (address: Parameters<ForgeReader["readTree"]>[0], access: Parameters<ForgeReader["readTree"]>[1]) =>
  new Api(address, access, {
    api: `${API}/`,
    authorization: (token) => ({ Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" }),
  });

export const github: ForgeReader = {
  async readTree(address, access) {
    checkAddress(address);
    const client = api(address, access);
    const base = `${API}/repos/${address.owner}/${address.name}`;
    const { value: repository } = await client.json<RepositoryResponse>(base);
    const branch = address.branch ?? repository.default_branch;
    const { value: commit } = await client.json<CommitResponse>(
      `${base}/commits/${encodePath(branch)}`,
      `${address.owner}/${address.name} has no branch ${branch}.`,
    );
    if (!COMMIT_ID.test(commit.sha) || !COMMIT_ID.test(commit.commit.tree.sha))
      throw new Error("GitHub answered with something unexpected.");
    const { value: tree } = await client.json<TreeResponse>(`${base}/git/trees/${commit.commit.tree.sha}?recursive=1`);

    const skipped: SkippedFile[] = [];
    const files: TreeFile[] = [];
    for (const entry of tree.tree) {
      if (entry.type === "tree") continue;
      if (entry.type === "commit") skipped.push({ path: entry.path, reason: "submodule" });
      else if (entry.mode === "120000") skipped.push({ path: entry.path, reason: "link" });
      else if (entry.type !== "blob" || !COMMIT_ID.test(entry.sha) || !safePath(entry.path))
        skipped.push({ path: entry.path, reason: "path" });
      else if ((entry.size ?? 0) > MAX_FILE_BYTES) skipped.push({ path: entry.path, reason: "large" });
      else files.push({ path: entry.path, id: entry.sha, size: entry.size ?? 0 });
    }
    return {
      address,
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
        author: commit.commit.author ?? nobody,
        committer: commit.commit.committer ?? nobody,
      },
      files: files.sort(byPath),
      skipped: skipped.sort(byPath),
      truncated: tree.truncated,
    };
  },

  readFiles(tree, files, access) {
    const client = api(tree.address, access);
    return access.token
      ? client.files(files, (file) => `${API}/repos/${tree.owner}/${tree.name}/git/blobs/${file.id}`, "application/vnd.github.raw+json")
      : client.files(files, (file) => `${RAW}/${tree.owner}/${tree.name}/${tree.commit.sha}/${encodePath(file.path)}`);
  },
};
