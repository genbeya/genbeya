/**
 * Moving the current branch to another commit with `git reset`, and what
 * that would do. Callers validate commits; they still follow
 * `--end-of-options`, so none is ever read as an option.
 */
import type { ResetMode, ResetPlan, ResetResult } from "../../contracts/model";
import { sha256, sha256Bytes } from "../../utilities/bytes";
import { splitIntoBatches } from "../../utilities/serial-queue";
import { failure, GitError, type Git } from "./git";

/** What a hard or keep reset to a commit can lose, and a fingerprint of it. */
interface AtStake {
  readonly uncommitted: string[];
  readonly overwritten: string[];
  readonly state: string;
}

export class ResetAccess {
  constructor(private readonly git: Git) {}

  async plan(target: string): Promise<ResetPlan> {
    const [{ head }, from, to] = await Promise.all([this.git.status(), this.git.objectId("HEAD"), this.commit(target)]);
    if (!from) throw new GitError("There is no commit to reset yet.");
    if (!head.branch) throw new GitError("Switch to a branch first.");
    return {
      branch: head.branch,
      head: from,
      target: to,
      commits: await this.count(to, from),
      upstream: head.upstream,
      pushed: head.upstream ? await this.pushed(to, from, head.upstream) : 0,
      ...(await this.atStake(to)),
    };
  }

  /** The fingerprint of what a hard or keep reset to `target` would lose, as {@link plan} has it. */
  async state(target: string): Promise<string> {
    return (await this.atStake(await this.commit(target))).state;
  }

  /** Moves the current branch to `target`; what happens to the index and working tree depends on `mode`. */
  async reset(target: string, mode: ResetMode): Promise<ResetResult> {
    const from = await this.commit("HEAD");
    const args = ["reset", "--quiet", `--${mode}`, "--end-of-options", target];
    const result = await this.git.run(args);
    if (result.code !== 0) {
      const blocked = /Entry '(.+)' not uptodate/.exec(result.stderr);
      if (mode === "keep" && blocked)
        throw new GitError(`Keep would overwrite your uncommitted changes to ${blocked[1]}. Commit or stash them, or choose another mode.`);
      const untracked = /Untracked working tree file '(.+)' would be overwritten/.exec(result.stderr);
      if (mode === "keep" && untracked)
        throw new GitError(`Keep would overwrite the untracked file ${untracked[1]}. Move it away, or choose another mode.`);
      throw failure(args, result);
    }
    return { from, to: await this.commit("HEAD") };
  }

  /**
   * The tracked files with uncommitted changes, the untracked and ignored
   * files `target` has and HEAD has not (which hard and keep overwrite),
   * and a fingerprint of all of them: of the staged and unstaged changes,
   * and of those files' content.
   */
  private async atStake(target: string): Promise<AtStake> {
    const { changes } = await this.git.status();
    const uncommitted = changes.filter((change) => change.index !== "?").map((change) => change.path);
    const added = (
      await this.git.text(["diff", "--name-only", "-z", "--no-renames", "--diff-filter=A", "--end-of-options", "HEAD", target, "--"])
    )
      .split("\0")
      .filter(Boolean);
    const overwritten: string[] = [];
    for (const batch of splitIntoBatches(added))
      overwritten.push(...(await this.git.text(["ls-files", "--others", "-z", "--", ...batch])).split("\0").filter(Boolean));
    overwritten.sort();
    const parts = [
      await this.git.bytes(["diff", "--cached", "--raw", "-z", "--no-abbrev", "--no-renames", "HEAD", "--"]),
      await this.git.bytes(["diff", "--binary", "--full-index", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames", "--"]),
    ].map(sha256Bytes);
    for (const batch of splitIntoBatches(overwritten))
      // A file gone meanwhile changes the fingerprint too.
      parts.push((await this.git.attempt(["hash-object", "--no-filters", "--", ...batch])) ?? "gone");
    return { uncommitted, overwritten, state: sha256([...overwritten, ...parts].join("\0")) };
  }

  /** The parent of the last commit, which undoing that commit goes back to. */
  async parentOfHead(): Promise<string> {
    const [, ...parents] = (await this.git.text(["rev-list", "--parents", "--max-count=1", "HEAD"])).trim().split(" ");
    if (!parents.length) throw new GitError("The last commit is the first one; there is nothing before it to go back to.");
    if (parents.length > 1) throw new GitError("The last commit is a merge. Reset the branch from History to choose where it goes.");
    return parents[0]!;
  }

  private async commit(revision: string): Promise<string> {
    return (await this.git.text(["rev-parse", "--verify", "--end-of-options", `${revision}^{commit}`])).trim();
  }

  /** Commits `to` reaches and `from` does not. */
  private async count(from: string, to: string): Promise<number> {
    return Number(await this.git.text(["rev-list", "--count", `${from}..${to}`]));
  }

  /** How many of the commits a reset from `head` to `target` leaves the upstream already has. */
  private async pushed(target: string, head: string, upstream: string): Promise<number> {
    const tip = await this.git.objectId(`refs/remotes/${upstream}`);
    // Exit code 1: the histories share no commit.
    const base = tip && (await this.git.attempt(["merge-base", head, tip]))?.trim();
    return base ? this.count(target, base) : 0;
  }
}
