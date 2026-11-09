/**
 * Bitbucket Cloud (API 2.0): the repository, the branch, and the tree as one listing that recurses into
 * folders (`max_depth`), in pages; files raw by path at the commit. Tokens go in `Authorization: Bearer`,
 * which repository, project and workspace access tokens take. Bitbucket Data Center has another API.
 */
import {
  allPages,
  Api,
  byPath,
  checkAddress,
  COMMIT_ID,
  encodePath,
  MAX_FILE_BYTES,
  parsePerson,
  safePath,
  type ForgeAccess,
  type ForgeReader,
  type SkippedFile,
  type TreeFile,
} from "./forge";
import type { ForgeAddress } from "../../utilities/forge-address";

export const API = "https://api.bitbucket.org/2.0";

interface RepositoryResponse {
  readonly full_name: string;
  readonly is_private: boolean;
  readonly mainbranch: { readonly name: string } | null;
  readonly links: { readonly html: { readonly href: string }; readonly clone: readonly { readonly name: string; readonly href: string }[] };
}

interface BranchResponse {
  readonly target: { readonly hash: string; readonly message: string; readonly date: string; readonly author: { readonly raw?: string } };
}

interface Entry {
  readonly type: string;
  readonly path: string;
  readonly size?: number | null;
  readonly attributes?: readonly string[] | null;
}

const base = (address: ForgeAddress) => `${API}/repositories/${encodeURIComponent(address.owner)}/${encodeURIComponent(address.name)}`;
const api = (address: ForgeAddress, access: ForgeAccess) =>
  new Api(address, access, { api: `${API}/`, authorization: (token) => ({ Authorization: `Bearer ${token}` }) });

export const bitbucket: ForgeReader = {
  async readTree(address, access) {
    checkAddress(address);
    const client = api(address, access);
    const repo = base(address);
    const { value: repository } = await client.json<RepositoryResponse>(repo);
    if (!repository.mainbranch && !address.branch) throw new Error(`${address.owner}/${address.name} has no commits yet.`);
    const branch = address.branch ?? repository.mainbranch!.name;
    const {
      value: { target },
    } = await client.json<BranchResponse>(
      `${repo}/refs/branches/${encodeURIComponent(branch)}`,
      `${address.owner}/${address.name} has no branch ${branch}.`,
    );
    if (!COMMIT_ID.test(target.hash)) throw new Error("Bitbucket answered with something unexpected.");
    const listing = await allPages<Entry>(`${repo}/src/${target.hash}/?max_depth=50&pagelen=100`, client, async (url) => {
      const { value } = await client.json<{ values: Entry[]; next?: string }>(url);
      return { items: value.values, next: value.next ?? null };
    });

    const skipped: SkippedFile[] = [];
    const files: TreeFile[] = [];
    for (const entry of listing.items) {
      if (entry.type !== "commit_file") continue;
      const attributes = entry.attributes ?? [];
      if (attributes.includes("subrepository")) skipped.push({ path: entry.path, reason: "submodule" });
      else if (attributes.includes("link")) skipped.push({ path: entry.path, reason: "link" });
      else if (!safePath(entry.path)) skipped.push({ path: entry.path, reason: "path" });
      else if ((entry.size ?? 0) > MAX_FILE_BYTES) skipped.push({ path: entry.path, reason: "large" });
      else files.push({ path: entry.path, id: entry.path, size: entry.size ?? 0 });
    }
    const [owner = address.owner, name = address.name] = repository.full_name.split("/");
    const clone = repository.links.clone.find((link) => link.name === "https")?.href ?? `https://bitbucket.org/${repository.full_name}.git`;
    const person = parsePerson(target.author.raw, target.date);
    return {
      address,
      owner,
      name,
      private: repository.is_private,
      webUrl: repository.links.html.href,
      // A clone URL may name the signed-in user; it is kept without.
      cloneUrl: clone.replace(/^https:\/\/[^@/]+@/, "https://"),
      defaultBranch: repository.mainbranch?.name ?? branch,
      branch,
      commit: { sha: target.hash, message: target.message, author: person, committer: person },
      files: files.sort(byPath),
      skipped: skipped.sort(byPath),
      truncated: listing.truncated,
    };
  },

  readFiles(tree, files, access) {
    const repo = base(tree.address);
    return api(tree.address, access).files(files, (file) => `${repo}/src/${tree.commit.sha}/${encodePath(file.id)}`);
  },
};
