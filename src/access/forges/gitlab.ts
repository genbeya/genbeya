/**
 * GitLab, on gitlab.com or a server of its own (API v4): the project, the branch, and the tree, which
 * comes in pages of 100 without file sizes; files are the API's raw blobs. GitLab's `/-/raw/` files don't
 * answer other origins, its API does. Tokens go in `Authorization: Bearer`, which personal, project and
 * group access tokens all take.
 */
import {
  allPages,
  Api,
  byPath,
  checkAddress,
  COMMIT_ID,
  nextLink,
  safePath,
  upgraded,
  type ForgeAccess,
  type ForgeReader,
  type SkippedFile,
  type TreeFile,
} from "./forge";
import type { ForgeAddress } from "../../utilities/forge-address";

interface ProjectResponse {
  readonly path_with_namespace: string;
  readonly visibility: string;
  readonly web_url: string;
  readonly http_url_to_repo: string;
  readonly default_branch: string | null;
}

interface BranchResponse {
  readonly commit: {
    readonly id: string;
    readonly message: string;
    readonly author_name: string;
    readonly author_email: string;
    readonly authored_date: string;
    readonly committer_name: string;
    readonly committer_email: string;
    readonly committed_date: string;
  };
}

interface TreeEntry {
  readonly id: string;
  readonly path: string;
  readonly type: string;
  readonly mode: string;
}

const base = (address: ForgeAddress) => `https://${address.host}/api/v4/projects/${encodeURIComponent(`${address.owner}/${address.name}`)}`;
const api = (address: ForgeAddress, access: ForgeAccess) =>
  new Api(address, access, { api: `https://${address.host}/api/v4/`, authorization: (token) => ({ Authorization: `Bearer ${token}` }) });

export const gitlab: ForgeReader = {
  async readTree(address, access) {
    checkAddress(address);
    const client = api(address, access);
    const project = base(address);
    const { value: repository } = await client.json<ProjectResponse>(project);
    if (!repository.default_branch && !address.branch) throw new Error(`${address.owner}/${address.name} has no commits yet.`);
    const branch = address.branch ?? repository.default_branch!;
    const { value: head } = await client.json<BranchResponse>(
      `${project}/repository/branches/${encodeURIComponent(branch)}`,
      `${address.owner}/${address.name} has no branch ${branch}.`,
    );
    const { commit } = head;
    if (!COMMIT_ID.test(commit.id)) throw new Error("GitLab answered with something unexpected.");
    const listing = await allPages<TreeEntry>(
      `${project}/repository/tree?ref=${commit.id}&recursive=true&per_page=100&pagination=keyset`,
      client,
      async (url) => {
        const { value, response } = await client.json<TreeEntry[]>(url);
        return { items: value, next: nextLink(response) };
      },
    );

    const skipped: SkippedFile[] = [];
    const files: TreeFile[] = [];
    for (const entry of listing.items) {
      if (entry.type === "tree") continue;
      if (entry.type === "commit") skipped.push({ path: entry.path, reason: "submodule" });
      else if (entry.mode === "120000") skipped.push({ path: entry.path, reason: "link" });
      else if (entry.type !== "blob" || !COMMIT_ID.test(entry.id) || !safePath(entry.path))
        skipped.push({ path: entry.path, reason: "path" });
      else files.push({ path: entry.path, id: entry.id, size: 0 });
    }
    const at = repository.path_with_namespace.lastIndexOf("/");
    return {
      address,
      owner: repository.path_with_namespace.slice(0, at),
      name: repository.path_with_namespace.slice(at + 1),
      private: repository.visibility !== "public",
      webUrl: upgraded(repository.web_url, address.host),
      cloneUrl: upgraded(repository.http_url_to_repo, address.host),
      defaultBranch: repository.default_branch ?? branch,
      branch,
      commit: {
        sha: commit.id,
        message: commit.message,
        author: { name: commit.author_name, email: commit.author_email, date: commit.authored_date },
        committer: { name: commit.committer_name, email: commit.committer_email, date: commit.committed_date },
      },
      files: files.sort(byPath),
      skipped: skipped.sort(byPath),
      truncated: listing.truncated,
    };
  },

  readFiles(tree, files, access) {
    const project = base(tree.address);
    return api(tree.address, access).files(files, (file) => `${project}/repository/blobs/${file.id}/raw`);
  },
};
