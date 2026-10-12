/**
 * Remotes of the in-memory repository. The repository behind each remote is
 * simulated too: branches, tags and a HEAD sharing the commits of the
 * local one, so fetching, pulling, pushing, publishing and force pushing
 * behave as with a real server, rejections included.
 */
import type { ForcePushPlan, OperationOutcome, PushOutcome, PushPlan, Remote } from "../../contracts/model";
import { isDefaultBranch } from "../../contracts/model";
import type { MemoryRepository } from "./memory-repository";

export interface RemoteServer {
  url: string;
  readonly branches: Map<string, string>;
  readonly tags: Map<string, string>;
  /** The branch its HEAD names; null while it has none. */
  head: string | null;
}

/** The commits a force push removes that are listed; the plan counts all of them. */
const REMOVED_LIMIT = 100;

export interface PushTargetRequest {
  readonly branch: string;
  readonly remote: string;
  readonly remoteBranch: string;
  readonly setUpstream: boolean;
  readonly force?: { readonly expected: string | null };
}

export class MemoryRemotes {
  constructor(private readonly repository: MemoryRepository) {}

  list(): Remote[] {
    return [...this.repository.remotes].sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, server]) => ({ name, url: server.url }));
  }

  names(): string[] {
    return this.list().map((remote) => remote.name);
  }

  /** Adds a remote, behind which an empty repository waits, or changes the URL of one. */
  set(name: string, url: string): void {
    const server = this.repository.remotes.get(name);
    if (server) server.url = url;
    else this.repository.remotes.set(name, { url, branches: new Map(), tags: new Map(), head: null });
  }

  remove(name: string): void {
    const repository = this.repository;
    repository.remotes.delete(name);
    repository.remoteHeads.delete(name);
    for (const ref of [...repository.tracking.keys()]) if (ref.startsWith(`${name}/`)) repository.tracking.delete(ref);
    for (const [branch, upstream] of [...repository.upstreams]) if (upstream.remote === name) repository.upstreams.delete(branch);
  }

  /** `git fetch --prune`: the remote-tracking branches become the remote's branches; tags on them come along. */
  fetch(remote: string): void {
    const repository = this.repository;
    const server = this.server(remote);
    for (const ref of [...repository.tracking.keys()]) if (ref.startsWith(`${remote}/`)) repository.tracking.delete(ref);
    for (const [branch, hash] of server.branches) repository.tracking.set(`${remote}/${branch}`, hash);
    if (server.head) repository.remoteHeads.set(remote, server.head);
    const fetched = [...server.branches.values()];
    for (const [name, commit] of server.tags)
      if (!repository.tags.has(name) && fetched.some((tip) => repository.commits.isAncestor(commit, tip)))
        repository.tags.set(name, { commit, message: "" });
  }

  /** `git pull --ff-only`: fetches, then fast-forwards `branch` to what it tracks on `remote`. */
  pull(remote: string, branch: string): void {
    const repository = this.repository;
    const target = this.fetchTracked(remote, branch);
    const head = repository.headCommit();
    if (head && repository.commits.isAncestor(target, head)) return;
    if (head && !repository.commits.isAncestor(head, target))
      throw new Error(
        `${branch} and ${remote} both have commits the other lacks, so ${branch} can't simply move ahead. Pull with rebase, or merge.`,
      );
    repository.checkout(repository.treeOf(target), "the pull");
    repository.setHead(target);
  }

  /** Fetches, then rebases `branch` onto what it tracks on `remote`. */
  pullRebase(remote: string, branch: string, autostash: boolean): OperationOutcome {
    return this.repository.operations.rebase(this.fetchTracked(remote, branch), autostash);
  }

  /**
   * Pushes `branch` where it pushes by default: to the branch it tracks on
   * `remote`, or one of its name, which it then tracks when it tracked
   * nothing. Rejected when the remote branch has commits it lacks.
   */
  pushBranch(remote: string, branch: string): void {
    const upstream = this.repository.upstreams.get(branch);
    const remoteBranch = upstream?.remote === remote ? upstream.branch : branch;
    const outcome = this.push({ branch, remote, remoteBranch, setUpstream: !upstream });
    if (outcome === "rejected")
      throw new Error(`${remote}/${remoteBranch} has commits that ${branch} lacks. Pull them first, or force push.`);
  }

  /** Pushes a local branch to a branch of any name; a force push only replaces what the remote-tracking branch said was there. */
  push({ branch, remote, remoteBranch, setUpstream, force }: PushTargetRequest): PushOutcome {
    const repository = this.repository;
    const server = this.server(remote);
    const local = repository.branches.get(branch)!;
    const current = server.branches.get(remoteBranch);
    if (force) {
      if ((current ?? null) !== force.expected)
        throw new Error(`${remote}/${remoteBranch} changed since your last fetch. Fetch and review it first.`);
    } else if (current && !repository.commits.isAncestor(current, local)) return "rejected";
    server.branches.set(remoteBranch, local);
    server.head ??= remoteBranch;
    repository.tracking.set(`${remote}/${remoteBranch}`, local);
    if (setUpstream) repository.upstreams.set(branch, { remote, branch: remoteBranch });
    return "done";
  }

  deleteBranch(remote: string, branch: string): void {
    const server = this.server(remote);
    if (!server.branches.delete(branch)) throw new Error(`${remote} has no branch ${branch}.`);
    if (server.head === branch) server.head = null;
    this.repository.tracking.delete(`${remote}/${branch}`);
  }

  pushTag(remote: string, name: string): void {
    this.server(remote).tags.set(name, this.repository.tags.get(name)!.commit);
  }

  deleteTag(remote: string, name: string): void {
    if (!this.server(remote).tags.delete(name)) throw new Error(`${remote} has no tag ${name}.`);
  }

  /** The branch a remote's HEAD names, as the last fetch recorded it, else as the remote says. */
  defaultBranch(remote: string): string | null {
    return this.repository.remoteHeads.get(remote) ?? this.server(remote).head;
  }

  /** Where a local branch can be pushed: its upstream, and each remote's branches as last fetched. */
  plan(branch: string): PushPlan {
    const repository = this.repository;
    const upstream = repository.upstreams.get(branch);
    const remotes = this.names();
    return {
      branch,
      upstream: upstream && remotes.includes(upstream.remote) ? { ...upstream } : null,
      remotes: remotes.map((remote) => ({
        remote,
        defaultBranch: this.defaultBranch(remote),
        branches: [...repository.tracking.keys()]
          .filter((ref) => ref.startsWith(`${remote}/`))
          .map((ref) => ref.slice(remote.length + 1))
          .sort(),
      })),
    };
  }

  /** What force pushing `branch` to `remoteBranch` would replace, as of the last fetch. */
  forcePlan(branch: string, remote: string, remoteBranch: string): ForcePushPlan {
    const repository = this.repository;
    const expected = repository.tracking.get(`${remote}/${remoteBranch}`) ?? null;
    const removed = expected ? repository.commits.range(repository.branches.get(branch)!, expected) : [];
    const decorations = repository.decorations();
    return {
      expected,
      removed: removed.slice(0, REMOVED_LIMIT).map((commit) => repository.describe(commit, decorations)),
      total: removed.length,
      defaultBranch: isDefaultBranch(remoteBranch, this.defaultBranch(remote)),
    };
  }

  /** Fetches `remote`, then names the commit `branch` tracks there: its upstream on that remote, or a branch of its name. */
  private fetchTracked(remote: string, branch: string): string {
    this.fetch(remote);
    const upstream = this.repository.upstreams.get(branch);
    const tracked = upstream?.remote === remote ? upstream.branch : branch;
    const target = this.repository.tracking.get(`${remote}/${tracked}`);
    if (!target) throw new Error(`${remote} has no branch ${tracked}.`);
    return target;
  }

  private server(remote: string): RemoteServer {
    const server = this.repository.remotes.get(remote);
    if (!server) throw new Error(`There is no remote ${remote}.`);
    return server;
  }
}
