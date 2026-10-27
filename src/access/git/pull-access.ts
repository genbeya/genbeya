/**
 * What merging one branch into another brings, for pull requests: the
 * commits, the files, a change ID that survives rebases, and whether the
 * merge would conflict, worked out without touching the working tree.
 */
import type { ComparedRevision, PullComparison } from "../../contracts/model";
import { sha256 } from "../../utilities/bytes";
import type { Git } from "./git";
import { parseNameStatus } from "./git-parsers";

/** `git merge-tree --write-tree` checks a merge without a working tree since Git 2.38. */
const MERGE_TREE = { major: 2, minor: 38, patch: 0 } as const;

/**
 * The ID of a change: the diff from `base` to `head` with what moves when a
 * change is rebased (hunk positions, blob IDs) left out, so the same change
 * on a moved target keeps its ID. The Markdown files directly in the
 * folder `exclude`, pull request files, don't count.
 */
export async function changeId(git: Git, base: string, head: string, exclude: string | null): Promise<string> {
  const diff = await git.output(
    [
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      "--unified=3",
      base,
      head,
      "--",
      ".",
      // Only pull request files: anything else in their folder is reviewed like code.
      ...(exclude ? [`:(exclude,glob)${exclude.replace(/[*?[\]\\]/g, "\\$&")}/*.md`] : []),
    ],
    // The exclusion is pathspec magic, which Genbeya otherwise turns off.
    { pathspecMagic: true },
  );
  const kept = diff.split("\n").filter((line) => !line.startsWith("@@") && !line.startsWith("index "));
  return sha256(kept.join("\n"));
}

export async function compareBranches(
  git: Git,
  source: string,
  target: string,
  revisions: readonly string[],
  exclude: string | null,
): Promise<PullComparison> {
  const [head, targetCommit] = await Promise.all([git.objectId(`${source}^{commit}`), git.objectId(`${target}^{commit}`)]);
  const mergeBase = async (a: string, b: string) => (await git.attempt(["merge-base", a, b]))?.trim() || null;
  const compared = async (revision: string): Promise<ComparedRevision> => {
    const commit = await git.objectId(`${revision}^{commit}`);
    const base = commit && targetCommit ? await mergeBase(targetCommit, commit) : null;
    return { revision, commit, change: commit && base ? await changeId(git, base, commit, exclude) : null };
  };
  const asked = await Promise.all(revisions.map(compared));
  if (!head || !targetCommit)
    return { head, target: targetCommit, base: null, ahead: 0, behind: 0, files: [], change: null, revisions: asked, conflicts: null };
  const base = await mergeBase(targetCommit, head);
  const [counts, names, change, conflicts] = await Promise.all([
    git.text(["rev-list", "--left-right", "--count", `${targetCommit}...${head}`]),
    base ? git.text(["diff", "--name-status", "-z", "-M", base, head]) : "",
    base ? changeId(git, base, head, exclude) : null,
    conflictsOf(git, targetCommit, head),
  ]);
  const [behind = 0, ahead = 0] = counts.trim().split(/\s+/).map(Number);
  return { head, target: targetCommit, base, ahead, behind, files: parseNameStatus(names), change, revisions: asked, conflicts };
}

/** Whether merging `head` into `target` conflicts: null when this Git can't say without a working tree. */
async function conflictsOf(git: Git, target: string, head: string): Promise<boolean | null> {
  if (!(await git.supports(MERGE_TREE))) return null;
  const result = await git.run(["merge-tree", "--write-tree", "--no-messages", target, head]);
  // 0 merges cleanly, 1 conflicts; anything else is an error, such as unrelated histories.
  return result.code === 0 ? false : result.code === 1 ? true : null;
}
