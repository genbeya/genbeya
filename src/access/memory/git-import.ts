/**
 * Imports a real Git repository into an in-memory one, for the web demo's
 * experiment with real repositories: every commit the refs reach with its
 * whole tree, under the IDs Git gave them, the branches, tags, remotes and
 * upstreams, and HEAD's tree checked out. Files are text in the model, so
 * binary files come out mangled; submodules are left out.
 */
import { decodeLenient, isBinary } from "../../utilities/bytes";
import type { CommitObject, Tree } from "./commits";
import { GitObjects, parseHeaders, parsePerson, parseTree, type GitDirectory, type Inflate } from "./git-objects";
import { MemoryRepository, type MemoryRepositoryOptions } from "./memory-repository";

export interface ImportStatistics {
  readonly commits: number;
  /** Files in HEAD's tree. */
  readonly files: number;
  /** Distinct file contents across the history. */
  readonly blobs: number;
  /** Of those, the ones that aren't text. */
  readonly binaryBlobs: number;
  /** Submodules and other entries the model can't hold. */
  readonly skippedEntries: number;
  /** Commits whose parents the clone doesn't have, as in a shallow clone. */
  readonly boundaryCommits: number;
  readonly packBytes: number;
  readonly packedObjects: number;
  readonly inflatedObjects: number;
  readonly milliseconds: number;
}

export interface ImportOptions extends MemoryRepositoryOptions {
  /** The URL to show for `remote` instead of the one in the clone's configuration, such as the URL behind a relay. */
  readonly remoteUrls?: ReadonlyMap<string, string>;
}

export async function importRepository(
  directory: GitDirectory,
  inflate: Inflate,
  options: ImportOptions,
): Promise<{ repository: MemoryRepository; statistics: ImportStatistics }> {
  const started = performance.now();
  const objects = await GitObjects.open(directory, inflate);
  const repository = new MemoryRepository(options);
  const refs = await objects.refs();
  const config = await objects.config();

  const blobs = new Map<string, string>();
  let binaryBlobs = 0;
  let skippedEntries = 0;
  /** The files below a tree, as paths relative to it and blob IDs. */
  const flattened = new Map<string, readonly (readonly [string, string])[]>();
  const flatten = async (id: string): Promise<readonly (readonly [string, string])[]> => {
    const known = flattened.get(id);
    if (known) return known;
    const files: (readonly [string, string])[] = [];
    for (const entry of parseTree((await objects.read(id)).data)) {
      if (entry.mode === "40000") for (const [path, blob] of await flatten(entry.id)) files.push([`${entry.name}/${path}`, blob]);
      // Files, executable ones and symbolic links (whose content is their target); submodules have no content here.
      else if (entry.mode === "100644" || entry.mode === "100755" || entry.mode === "120000") files.push([entry.name, entry.id]);
      else skippedEntries++;
    }
    flattened.set(id, files);
    return files;
  };
  const content = async (id: string): Promise<string> => {
    const known = blobs.get(id);
    if (known !== undefined) return known;
    const data = (await objects.read(id)).data;
    if (isBinary(data)) binaryBlobs++;
    const text = decodeLenient(data);
    blobs.set(id, text);
    return text;
  };
  const trees = new Map<string, Tree>();
  const treeOf = async (id: string): Promise<Tree> => {
    const known = trees.get(id);
    if (known) return known;
    const tree = new Map<string, string>();
    for (const [path, blob] of await flatten(id)) tree.set(path, await content(blob));
    trees.set(id, tree);
    return tree;
  };

  /** The commit an object ID names, peeling annotated tags; null for refs to trees or blobs. */
  const tags = new Map<string, { commit: string; message: string }>();
  const peel = async (id: string): Promise<{ commit: string; message: string } | null> => {
    let object = await objects.read(id);
    let message = "";
    for (let depth = 0; object.type === "tag" && depth < 10; depth++) {
      const tag = parseHeaders(object.data);
      message ||= tag.message.trimEnd();
      id = tag.headers.find(([key]) => key === "object")![1];
      object = await objects.read(id);
    }
    return object.type === "commit" ? { commit: id, message } : null;
  };

  const resolved = new Map(refs.map((ref) => [ref.name, ref]));
  const target = (name: string): string | null => {
    for (let ref = resolved.get(name), depth = 0; ref && depth < 10; ref = resolved.get(ref.target), depth++)
      if (!ref.symbolic) return ref.target;
    return null;
  };

  // The refs the model keeps.
  const tips = new Set<string>();
  for (const ref of refs) {
    if (ref.symbolic) continue;
    if (ref.name.startsWith("refs/heads/")) repository.branches.set(ref.name.slice(11), ref.target);
    else if (ref.name.startsWith("refs/remotes/")) repository.tracking.set(ref.name.slice(13), ref.target);
    else if (ref.name.startsWith("refs/tags/")) {
      const tag = await peel(ref.target);
      if (tag) tags.set(ref.name.slice(10), tag);
      if (tag) tips.add(tag.commit);
      continue;
    } else continue;
    tips.add(ref.target);
  }
  for (const [name, tag] of tags) repository.tags.set(name, tag);
  const head = resolved.get("HEAD");
  if (head?.symbolic && head.target.startsWith("refs/heads/")) repository.head = { branch: head.target.slice(11) };
  else if (head) repository.head = { detached: head.target };
  const headCommit = target("HEAD");
  if (headCommit) tips.add(headCommit);

  // Every commit the refs reach, each with its whole tree.
  let boundaryCommits = 0;
  const pending = [...tips];
  const seen = new Set<string>();
  const commits: CommitObject[] = [];
  while (pending.length) {
    const id = pending.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const object = await objects.read(id);
    if (object.type !== "commit") continue;
    const { headers, message } = parseHeaders(object.data);
    const value = (key: string) => headers.find(([name]) => name === key)?.[1] ?? "";
    const parents: string[] = [];
    for (const [key, parent] of headers) {
      if (key !== "parent") continue;
      // A shallow clone ends where its parents are missing.
      if (await objects.has(parent)) parents.push(parent);
      else boundaryCommits++;
    }
    commits.push({
      hash: id,
      parents,
      tree: await treeOf(value("tree")),
      author: parsePerson(value("author")),
      committer: parsePerson(value("committer")),
      message: message.trimEnd(),
    });
    pending.push(...parents);
  }
  for (const commit of commits) repository.commits.restore(commit);

  // Remotes, their HEADs and the branches' upstreams.
  for (const [section, keys] of config) {
    if (section.startsWith("remote.")) {
      const name = section.slice(7);
      const url = options.remoteUrls?.get(name) ?? keys.get("url") ?? "";
      const branches = new Map(
        [...repository.tracking].filter(([ref]) => ref.startsWith(`${name}/`)).map(([ref, hash]) => [ref.slice(name.length + 1), hash]),
      );
      const remoteHead = resolved.get(`refs/remotes/${name}/HEAD`);
      const headBranch = remoteHead?.symbolic ? remoteHead.target.slice(`refs/remotes/${name}/`.length) : null;
      if (headBranch) repository.remoteHeads.set(name, headBranch);
      repository.remotes.set(name, {
        url,
        branches,
        tags: new Map([...tags].map(([tag, { commit }]) => [tag, commit])),
        head: headBranch ?? (branches.has("main") ? "main" : branches.has("master") ? "master" : null),
      });
    } else if (section.startsWith("branch.")) {
      const remote = keys.get("remote");
      const merge = keys.get("merge");
      if (remote && merge?.startsWith("refs/heads/")) repository.upstreams.set(section.slice(7), { remote, branch: merge.slice(11) });
    }
  }
  // A remote-tracking HEAD isn't a branch of its own.
  for (const ref of [...repository.tracking.keys()]) if (ref.endsWith("/HEAD")) repository.tracking.delete(ref);

  // A clean checkout of HEAD.
  for (const [path, text] of repository.headTree()) {
    repository.worktree.set(path, text);
    repository.index.set(path, text);
  }

  return {
    repository,
    statistics: {
      commits: commits.length,
      files: repository.headTree().size,
      blobs: blobs.size,
      binaryBlobs,
      skippedEntries,
      boundaryCommits,
      packBytes: objects.packBytes,
      packedObjects: objects.packedObjects,
      inflatedObjects: objects.inflated,
      milliseconds: Math.round(performance.now() - started),
    },
  };
}
