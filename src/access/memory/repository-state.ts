/**
 * An in-memory repository as plain data and back: everything Git would keep in `.git` and the working
 * tree, so a repository can be kept and opened again as it was, with its commits, index, working tree,
 * branches, tags, remote-tracking branches, stashes, conflicts and an operation in progress. File
 * contents are kept once each, by their hash, however many commits and stages hold them.
 */
import { sha256 } from "../../utilities/bytes";
import type { Signature } from "./commits";
import { MemoryRepository, type HeadState, type MemoryRepositoryOptions, type Stages } from "./memory-repository";
import type { OperationState } from "./memory-operations";
import type { StashEntry } from "./memory-stashes";

export const STATE_VERSION = 1;

type Pairs<T> = readonly (readonly [string, T])[];

export interface RepositoryState {
  readonly version: typeof STATE_VERSION;
  /** File contents by their hash. */
  readonly blobs: Readonly<Record<string, string>>;
  readonly commits: readonly {
    readonly hash: string;
    readonly parents: readonly string[];
    /** Paths and the hashes of their contents. */
    readonly tree: Pairs<string>;
    readonly author: Signature;
    readonly committer: Signature;
    readonly message: string;
  }[];
  readonly worktree: Pairs<string>;
  readonly index: Pairs<string>;
  readonly conflicts: Pairs<{ readonly base?: string; readonly ours?: string; readonly theirs?: string }>;
  readonly head: HeadState;
  readonly branches: Pairs<string>;
  readonly tags: Pairs<{ readonly commit: string; readonly message: string }>;
  readonly tracking: Pairs<string>;
  readonly remoteHeads: Pairs<string>;
  readonly upstreams: Pairs<{ readonly remote: string; readonly branch: string }>;
  readonly remotes: Pairs<{
    readonly url: string;
    readonly branches: Pairs<string>;
    readonly tags: Pairs<string>;
    readonly head: string | null;
  }>;
  readonly stashes: readonly StashEntry[];
  readonly operation: OperationState | null;
}

/** `repository` as plain data, ready for `JSON.stringify`. */
export function saveRepository(repository: MemoryRepository): RepositoryState {
  const blobs: Record<string, string> = {};
  const blob = (content: string) => {
    const hash = sha256(content);
    blobs[hash] = content;
    return hash;
  };
  const files = (map: ReadonlyMap<string, string>): Pairs<string> => [...map].map(([path, content]) => [path, blob(content)]);
  return {
    version: STATE_VERSION,
    blobs,
    commits: [...repository.commits.all()].map(({ hash, parents, tree, author, committer, message }) => ({
      hash,
      parents,
      tree: files(tree),
      author,
      committer,
      message,
    })),
    worktree: files(repository.worktree),
    index: files(repository.index),
    conflicts: [...repository.conflicts].map(([path, stages]) => [path, mapStages(stages, blob)]),
    head: repository.head,
    branches: [...repository.branches],
    tags: [...repository.tags],
    tracking: [...repository.tracking],
    remoteHeads: [...repository.remoteHeads],
    upstreams: [...repository.upstreams],
    remotes: [...repository.remotes].map(([name, server]) => [
      name,
      { url: server.url, branches: [...server.branches], tags: [...server.tags], head: server.head },
    ]),
    stashes: repository.stashList,
    // Rebases keep counters they change as they go: a copy keeps the saved state apart from the live one.
    operation: repository.operation && structuredClone(repository.operation),
  };
}

/** The repository `state` describes; throws when it isn't one. */
export function loadRepository(state: RepositoryState, options: MemoryRepositoryOptions): MemoryRepository {
  if (state?.version !== STATE_VERSION) throw new Error("This kept repository was saved by another version of Genbeya.");
  const content = (hash: string) => {
    const text = state.blobs[hash];
    if (text === undefined) throw new Error("This kept repository is damaged: a file's content is missing.");
    return text;
  };
  const files = (pairs: Pairs<string>) => new Map(pairs.map(([path, hash]) => [path, content(hash)]));
  const repository = new MemoryRepository(options);
  for (const commit of state.commits) repository.commits.adopt({ ...commit, tree: files(commit.tree) });
  fill(repository.worktree, files(state.worktree));
  fill(repository.index, files(state.index));
  for (const [path, stages] of state.conflicts) repository.conflicts.set(path, mapStages(stages, content));
  repository.head = state.head;
  fill(repository.branches, state.branches);
  fill(repository.tags, state.tags);
  fill(repository.tracking, state.tracking);
  fill(repository.remoteHeads, state.remoteHeads);
  fill(repository.upstreams, state.upstreams);
  for (const [name, server] of state.remotes)
    repository.remotes.set(name, { url: server.url, branches: new Map(server.branches), tags: new Map(server.tags), head: server.head });
  repository.stashList = [...state.stashes];
  repository.operation = state.operation;
  return repository;
}

function fill<T>(map: Map<string, T>, entries: Iterable<readonly [string, T]>): void {
  for (const [key, value] of entries) map.set(key, value);
}

/** The stages a conflicted file has, each turned by `map`; missing ones stay missing. */
const mapStages = (stages: Stages, map: (value: string) => string): Stages =>
  Object.fromEntries(Object.entries(stages).flatMap(([key, value]) => (value === undefined ? [] : [[key, map(value)]])));
