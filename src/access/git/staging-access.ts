/**
 * Staging beyond whole files: the diff of one file as a patch, applying
 * patches to the index or the working tree, and comparing the index with
 * HEAD's parent while the last commit is being amended. Callers validate
 * paths; patches travel as files in the git directory, since hosts give
 * processes no standard input.
 */
import type { Amending, ChangeBase, Change, CommitFile } from "../../contracts/model";
import { fromByteString, toByteString } from "../../utilities/bytes";
import { splitIntoBatches } from "../../utilities/serial-queue";
import type { Host } from "../hosts/host";
import { failure, GitError, type Git } from "./git";
import { parseNameStatus } from "./git-parsers";

/** Where a patch waits for `git apply`, in the git directory. */
const PATCH_FILE = "genbeya.patch";

/** The empty tree, which a first commit is compared with, by object format. */
const EMPTY_TREES: Readonly<Record<string, string>> = {
  sha1: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
  sha256: "6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321",
};

/**
 * Plain unified diffs whatever the user's configuration says about
 * prefixes, external tools, text conversion and how changes are found: the
 * diff shown and the diff patched must place changes alike.
 */
export const DIFF_OPTIONS: readonly string[] = [
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
  "--src-prefix=a/",
  "--dst-prefix=b/",
  "--unified=3",
  "--diff-algorithm=myers",
  "--indent-heuristic",
  "--inter-hunk-context=0",
];
const DIFF = ["diff", ...DIFF_OPTIONS];

export const NOTHING_TO_AMEND = "There is no commit to amend yet.";

/** What a patch applies to, and which way. */
export interface PatchTarget {
  /** The index, instead of the working tree. */
  readonly cached: boolean;
  readonly reverse: boolean;
}

/** The changes with index letters comparing the index with another tree than HEAD's, which `staged` lists. */
export function restage(changes: readonly Change[], staged: readonly CommitFile[]): Change[] {
  const byPath = new Map(staged.map((file) => [file.path, file]));
  const result: Change[] = [];
  for (const change of changes) {
    if (change.conflict) {
      result.push(change);
      continue;
    }
    const file = byPath.get(change.path);
    byPath.delete(change.path);
    const index = file?.status ?? (change.index === "?" ? "?" : " ");
    if (index === " " && change.worktree === " ") continue;
    result.push({ path: change.path, ...(file?.oldPath ? { oldPath: file.oldPath } : {}), index, worktree: change.worktree });
  }
  for (const file of byPath.values())
    result.push({ path: file.path, ...(file.oldPath ? { oldPath: file.oldPath } : {}), index: file.status, worktree: " " });
  return result.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export class StagingAccess {
  /** The last {@link amending} answer, by the ids it depends on. */
  private amended: { key: string; value: Promise<Amending | null> } | null = null;

  constructor(
    private readonly host: Host,
    private readonly git: Git,
    private readonly gitDir: () => Promise<string>,
  ) {}

  /**
   * The tree-ish staged changes are compared with: HEAD (the empty tree on
   * an unborn branch), or HEAD's first parent (the empty tree for a first
   * commit). There is no parent to compare with before the first commit.
   */
  async base(base: ChangeBase): Promise<string> {
    const born = await this.git.hasRef("HEAD^{commit}");
    if (base === "head") return born ? "HEAD" : this.emptyTree();
    if (!born) throw new GitError(NOTHING_TO_AMEND);
    return (await this.git.objectId("HEAD^1^{commit}")) ?? this.emptyTree();
  }

  private async emptyTree(): Promise<string> {
    const format = (await this.git.attempt(["rev-parse", "--show-object-format"]))?.trim() ?? "sha1";
    return EMPTY_TREES[format] ?? EMPTY_TREES["sha1"]!;
  }

  /**
   * The commit an amend replaces; null before the first commit. Snapshots
   * ask on every poll while amending, so it is looked up again only once
   * HEAD or a remote branch moved: finding the branches that contain HEAD
   * walks the history.
   */
  async amending(): Promise<Amending | null> {
    // HEAD's id, then those of the remote branches.
    const key = await this.git.attempt(["rev-parse", "HEAD", "--remotes"]);
    if (!key?.trim()) return null;
    if (this.amended?.key !== key) this.amended = { key, value: this.lookUpAmending() };
    return this.amended.value;
  }

  private async lookUpAmending(): Promise<Amending | null> {
    const line = await this.git.attempt(["log", "-1", "--format=%h%x00%p", "HEAD"]);
    if (!line?.trim()) return null;
    const [commit, parents] = line.trim().split("\0") as [string, string];
    const parent = parents.split(" ").filter(Boolean);
    // Full names, since the short name of a remote's HEAD is the remote's name.
    const pushed = (await this.git.lines(["for-each-ref", "--contains=HEAD", "--format=%(refname)", "refs/remotes"]))
      .filter((ref) => !ref.endsWith("/HEAD"))
      .map((ref) => ref.slice("refs/remotes/".length));
    return { commit, parent: parent[0] ?? null, merge: parent.length > 1, pushed };
  }

  /** How the index differs from `tree`, with renames. */
  async staged(tree: string): Promise<CommitFile[]> {
    return parseNameStatus(await this.git.text(["diff", "--cached", "--name-status", "-z", "-M", tree, "--"]));
  }

  /**
   * Git's diff of one file, as a byte string ({@link toByteString}): the
   * working tree against the index, or the index against `tree` (with the
   * old path of a rename).
   */
  async diff(path: string, oldPath: string, tree: string | null): Promise<string> {
    const args =
      tree === null
        ? [...DIFF, "--no-renames", "--", path]
        : [...DIFF, "--cached", "-M", tree, "--", ...(oldPath === path ? [path] : [oldPath, path])];
    return toByteString(await this.git.bytes(args));
  }

  /** Applies a patch (a byte string) to the index or the working tree; context must match exactly. */
  async apply(patch: string, { cached, reverse }: PatchTarget): Promise<void> {
    const dir = await this.gitDir();
    await this.host.write(dir, PATCH_FILE, fromByteString(patch), false);
    try {
      const args = [
        "apply",
        ...(cached ? ["--cached"] : []),
        ...(reverse ? ["--reverse"] : []),
        "--no-ignore-whitespace",
        "--recount",
        "--whitespace=nowarn",
        `${dir}/${PATCH_FILE}`,
      ];
      const result = await this.git.run(args);
      if (result.code !== 0) throw failure(args, result);
    } finally {
      await this.host.remove(dir, PATCH_FILE).catch(() => undefined);
    }
  }

  /** Records an untracked file in the index without its content, so its diff can be staged in parts. */
  async intendToAdd(path: string): Promise<void> {
    await this.git.text(["add", "--intent-to-add", "--", path]);
  }

  /** Takes paths out of the index, keeping the files; with `force` even when the index holds content found nowhere else. */
  async untrack(paths: readonly string[], force = false): Promise<void> {
    for (const batch of splitIntoBatches(paths)) {
      const args = ["rm", "--cached", "-r", "--quiet", ...(force ? ["--force"] : []), "--", ...batch];
      const result = await this.git.run(args);
      if (result.code === 0) continue;
      // Git lists the files indented below its message.
      const lost = /staged content different from both the\s+file and the HEAD:\n((?:[ \t]+\S.*\n?)+)/.exec(result.stderr);
      if (!lost) throw failure(args, result);
      const files = lost[1]!.trim().split(/\s*\n\s*/);
      throw new GitError(
        `${files.join(", ")} ${files.length === 1 ? "has" : "have"} staged changes that are neither in the file nor in the last commit, which Stop tracking would lose. Commit or unstage them first.`,
      );
    }
  }

  /** Sets the index entries of `paths` to their version in `tree`, removing those it lacks. */
  async reset(tree: string, paths: readonly string[]): Promise<void> {
    for (const batch of splitIntoBatches(paths)) await this.git.text(["reset", "--quiet", tree, "--", ...batch]);
  }
}
