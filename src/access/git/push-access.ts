/**
 * Pushing local branches to branches of any name on a remote, setting
 * upstreams, and force pushing with a lease. Callers validate branches and
 * remotes; refs still go in their full form after `--end-of-options`, so
 * none is ever read as an option.
 */
import {
  isDefaultBranch,
  type ForcePushPlan,
  type PushOutcome,
  type PushPlan,
  type PushRequest,
  type PushTarget,
} from "../../contracts/model";
import { decodeLenient } from "../../utilities/bytes";
import { failure, GitError, NETWORK_TIMEOUT, type Git } from "./git";
import { LOG_FORMAT, parseLog, parsePushRejection } from "./git-parsers";

/** How long asking a remote for its default branch may take. */
const LOOKUP_TIMEOUT = 20_000;
/** The commits a force push removes that are listed; the plan counts all of them. */
const REMOVED_LIMIT = 100;
/** `--force-if-includes` is new in git 2.30. */
const FORCE_IF_INCLUDES = { major: 2, minor: 30, patch: 0 };

export class PushAccess {
  constructor(private readonly git: Git) {}

  async plan(branch: string): Promise<PushPlan> {
    const remotes = await this.git.lines(["remote"]);
    return {
      branch,
      upstream: await this.upstream(branch, remotes),
      remotes: await Promise.all(remotes.map((remote) => this.target(remote))),
    };
  }

  /**
   * The branch the remote's HEAD names: as the clone or the last
   * `remote set-head` recorded it, else as the remote says. Null when
   * neither knows, for example when the remote cannot be reached.
   */
  async defaultBranch(remote: string): Promise<string | null> {
    const prefix = `refs/remotes/${remote}/`;
    const recorded = (await this.git.attempt(["symbolic-ref", "--quiet", `${prefix}HEAD`]))?.trim();
    if (recorded?.startsWith(prefix)) return recorded.slice(prefix.length);
    const answer = await this.git.run(["ls-remote", "--symref", "--end-of-options", remote, "HEAD"], LOOKUP_TIMEOUT).catch(() => null);
    if (answer?.code !== 0) return null;
    return /^ref: refs\/heads\/(\S+)\tHEAD$/m.exec(decodeLenient(answer.stdout))?.[1] ?? null;
  }

  /** What force pushing `branch` to `remoteBranch` would replace, as of the last fetch. */
  async forcePlan(branch: string, remote: string, remoteBranch: string): Promise<ForcePushPlan> {
    const [expected, defaultBranch] = await Promise.all([
      this.git.objectId(`refs/remotes/${remote}/${remoteBranch}`),
      this.defaultBranch(remote),
    ]);
    const range = `refs/heads/${branch}..${expected}`;
    const [removed, total] = expected
      ? await Promise.all([
          this.git.text(["log", `--max-count=${REMOVED_LIMIT}`, `--format=${LOG_FORMAT}`, range]),
          this.git.text(["rev-list", "--count", range]),
        ])
      : ["", "0"];
    return { expected, removed: parseLog(removed), total: Number(total), defaultBranch: isDefaultBranch(remoteBranch, defaultBranch) };
  }

  /**
   * Pushes; "rejected" when the remote branch has commits the local one
   * lacks. A force push names the commit it expects the remote branch at,
   * so a fetch in between cannot make git expect what it fetched.
   */
  async push({ branch, remote, remoteBranch, setUpstream, force }: PushRequest): Promise<PushOutcome> {
    const target = `refs/heads/${remoteBranch}`;
    const args = [
      "push",
      ...(setUpstream ? ["--set-upstream"] : []),
      ...(force
        ? [
            `--force-with-lease=${target}:${force.expected ?? ""}`,
            ...((await this.git.supports(FORCE_IF_INCLUDES)) ? ["--force-if-includes"] : []),
          ]
        : []),
      "--end-of-options",
      remote,
      `refs/heads/${branch}:${target}`,
    ];
    const result = await this.git.run(args, NETWORK_TIMEOUT);
    if (result.code === 0) return "done";
    const rejection = parsePushRejection(result.stderr);
    if (rejection === "stale") throw new GitError(`${remote}/${remoteBranch} changed since your last fetch. Fetch and review it first.`);
    if (rejection === "behind" && !force) return "rejected";
    throw failure(args, result);
  }

  /** The remote branch `branch` pushes to and pulls from, when it is one of `remotes`. */
  private async upstream(branch: string, remotes: readonly string[]): Promise<PushPlan["upstream"]> {
    const [remote, merge] = await Promise.all([this.git.config(`branch.${branch}.remote`), this.git.config(`branch.${branch}.merge`)]);
    if (!remote || !remotes.includes(remote) || !merge?.startsWith("refs/heads/")) return null;
    return { remote, branch: merge.slice("refs/heads/".length) };
  }

  private async target(remote: string): Promise<PushTarget> {
    const prefix = `refs/remotes/${remote}/`;
    const [defaultBranch, refs] = await Promise.all([
      this.defaultBranch(remote),
      this.git.lines(["for-each-ref", "--format=%(refname)", prefix]),
    ]);
    const branches = refs.map((ref) => ref.slice(prefix.length)).filter((name) => name !== "HEAD");
    return { remote, defaultBranch, branches };
  }
}
