/**
 * Gitea and Forgejo, Codeberg's software, on a server of their own (API v1): the repository, the branch, and
 * the tree in pages; files raw by path at the commit. A server answers other origins only when its
 * administrator enabled CORS (`[cors] ENABLED = true`); Codeberg does. Tokens go in `Authorization: token`.
 */
import {
  allPages,
  Api,
  byPath,
  checkAddress,
  COMMIT_ID,
  encodePath,
  MAX_FILE_BYTES,
  safePath,
  upgraded,
  type ForgeAccess,
  type ForgeReader,
  type SkippedFile,
  type TreeFile,
} from "./forge";
import type { ForgeAddress } from "../../utilities/forge-address";

interface RepositoryResponse {
  readonly name: string;
  readonly owner: { readonly login: string };
  readonly private: boolean;
  readonly html_url: string;
  readonly clone_url: string;
  readonly default_branch: string;
}

interface Person {
  readonly name: string;
  readonly email: string;
}

interface BranchResponse {
  readonly commit: {
    readonly id: string;
    readonly message: string;
    readonly author: Person;
    readonly committer: Person;
    readonly timestamp: string;
  };
}

interface TreeResponse {
  readonly tree:
    readonly { readonly path: string; readonly mode: string; readonly type: string; readonly sha: string; readonly size: number }[] | null;
  /** Entries in all pages. */
  readonly total_count: number;
}

const PER_PAGE = 1000;
const base = (address: ForgeAddress) =>
  `https://${address.host}/api/v1/repos/${encodeURIComponent(address.owner)}/${encodeURIComponent(address.name)}`;
const api = (address: ForgeAddress, access: ForgeAccess) =>
  new Api(address, access, { api: `https://${address.host}/api/v1/`, authorization: (token) => ({ Authorization: `token ${token}` }) });

export const gitea: ForgeReader = {
  async readTree(address, access) {
    checkAddress(address);
    const client = api(address, access);
    const repo = base(address);
    const { value: repository } = await client.json<RepositoryResponse>(repo);
    const branch = address.branch ?? repository.default_branch;
    const {
      value: { commit },
    } = await client.json<BranchResponse>(
      `${repo}/branches/${encodePath(branch)}`,
      `${address.owner}/${address.name} has no branch ${branch}.`,
    );
    if (!COMMIT_ID.test(commit.id)) throw new Error("The forge answered with something unexpected.");
    let seen = 0;
    const listing = await allPages<NonNullable<TreeResponse["tree"]>[number]>(
      `${repo}/git/trees/${commit.id}?recursive=true&per_page=${PER_PAGE}&page=1`,
      client,
      async (url) => {
        const { value } = await client.json<TreeResponse>(url);
        const items = [...(value.tree ?? [])];
        seen += items.length;
        const page = Number(new URL(url).searchParams.get("page"));
        return { items, next: items.length && seen < value.total_count ? url.replace(/&page=\d+$/, `&page=${page + 1}`) : null };
      },
    );

    const skipped: SkippedFile[] = [];
    const files: TreeFile[] = [];
    for (const entry of listing.items) {
      if (entry.type === "tree") continue;
      if (entry.type === "commit") skipped.push({ path: entry.path, reason: "submodule" });
      else if (entry.mode === "120000") skipped.push({ path: entry.path, reason: "link" });
      else if (entry.type !== "blob" || !safePath(entry.path)) skipped.push({ path: entry.path, reason: "path" });
      else if (entry.size > MAX_FILE_BYTES) skipped.push({ path: entry.path, reason: "large" });
      else files.push({ path: entry.path, id: entry.path, size: entry.size });
    }
    const someone = (person: Person) => ({ name: person.name, email: person.email, date: commit.timestamp });
    return {
      address,
      owner: repository.owner.login,
      name: repository.name,
      private: repository.private,
      webUrl: upgraded(repository.html_url, address.host),
      cloneUrl: upgraded(repository.clone_url, address.host),
      defaultBranch: repository.default_branch,
      branch,
      commit: { sha: commit.id, message: commit.message, author: someone(commit.author), committer: someone(commit.committer) },
      files: files.sort(byPath),
      skipped: skipped.sort(byPath),
      truncated: listing.truncated,
    };
  },

  readFiles(tree, files, access) {
    const repo = base(tree.address);
    return api(tree.address, access).files(files, (file) => `${repo}/raw/${encodePath(file.id)}?ref=${tree.commit.sha}`);
  },
};
