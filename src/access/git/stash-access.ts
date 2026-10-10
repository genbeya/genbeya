/** The stash list of a repository: saving, showing, applying and dropping stashes. Callers validate their input. */
import type { OperationOutcome, Stash, StashDetail, StashOptions } from "../../contracts/model";
import { GitError, type Git } from "./git";
import { parseNameStatus, parseStashes, STASH_FORMAT } from "./git-parsers";

export class StashAccess {
  constructor(
    private readonly git: Git,
    /** True while files have unresolved conflicts. */
    private readonly conflicted: () => Promise<boolean>,
  ) {}

  /** Newest first. */
  async list(): Promise<Stash[]> {
    return parseStashes(await this.git.text(["stash", "list", `--format=${STASH_FORMAT}`]));
  }

  /** The stash with commit `hash`; an error when it is gone. */
  async find(hash: string): Promise<Stash> {
    const stash = (await this.list()).find((entry) => entry.hash === hash);
    if (!stash) throw new GitError("This stash no longer exists.");
    return stash;
  }

  async push({ message, includeUntracked, keepIndex }: StashOptions): Promise<void> {
    const args = [
      "stash",
      "push",
      "--quiet",
      ...(includeUntracked ? ["--include-untracked"] : []),
      ...(keepIndex ? ["--keep-index"] : []),
      ...(message ? ["--message", message] : []),
    ];
    // No paths are passed; stash itself cleans untracked files with the pathspec ":/".
    await this.git.output(args, { pathspecMagic: true });
  }

  /**
   * The files a stash changed, compared with the commit it was made on, then
   * the untracked files it holds, which live in a commit of their own.
   */
  async detail(stash: Stash): Promise<StashDetail> {
    const untracked = await this.git.objectId(`${stash.hash}^3`);
    const [tracked, added] = await Promise.all([
      this.git.text(["diff-tree", "-r", "--no-commit-id", "--name-status", "-z", "-M", `${stash.hash}^1`, stash.hash]),
      untracked ? this.git.text(["diff-tree", "--root", "-r", "--no-commit-id", "--name-status", "-z", untracked]) : "",
    ]);
    return {
      stash,
      files: [
        ...parseNameStatus(tracked).map((file) => ({ ...file, commit: stash.hash })),
        ...parseNameStatus(added).map((file) => ({ ...file, commit: untracked! })),
      ],
    };
  }

  /** Conflicts leave the stash in the list, also when popping. */
  apply(stash: Stash, pop: boolean): Promise<OperationOutcome> {
    return this.git.outcome(["stash", pop ? "pop" : "apply", "--quiet", "--end-of-options", ref(stash)], this.conflicted);
  }

  async drop(stash: Stash): Promise<void> {
    await this.git.text(["stash", "drop", "--quiet", "--end-of-options", ref(stash)]);
  }

  async branch(stash: Stash, name: string): Promise<void> {
    await this.git.text(["stash", "branch", "--end-of-options", name, ref(stash)]);
  }
}

const ref = (stash: Stash) => `stash@{${stash.index}}`;
