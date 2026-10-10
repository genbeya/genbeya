/** The committed history of single files in one working tree, read with a few git calls. */
import { decodeLenient } from "../../utilities/bytes";
import type { Git } from "./git";
import { FILE_LOG_FORMAT, parseFileLog, type FileRevision } from "./git-parsers";

/** Context lines enough for patches to hold whole files. */
const WHOLE_FILE = 1_000_000;

/**
 * The newest `limit` commits of the checked-out branch that changed `path`,
 * following renames. With `contents`, each holds the file before and after,
 * so the output grows with the file's size times `limit`.
 */
export async function fileHistory(git: Git, path: string, limit: number, contents: boolean): Promise<FileRevision[]> {
  const output = await git.attempt([
    "log",
    "--follow",
    "--no-merges",
    "--no-show-signature",
    `--max-count=${limit}`,
    `--format=${FILE_LOG_FORMAT}`,
    "--patch",
    `--unified=${contents ? WHOLE_FILE : 0}`,
    "--no-ext-diff",
    "--no-textconv",
    "--",
    path,
  ]);
  // A branch without commits has no history.
  return parseFileLog(output ?? "", path, contents);
}

/** `path` as committed at HEAD; null when HEAD has no such file or it is larger than `limit` bytes. */
export async function committedFile(git: Git, path: string, limit: number): Promise<string | null> {
  const id = await git.objectId(`HEAD:${path}`);
  if (!id || Number(await git.text(["cat-file", "-s", id])) > limit) return null;
  return decodeLenient(await git.bytes(["cat-file", "blob", id]));
}

/** The files below `folder` committed at HEAD. */
export async function committedFiles(git: Git, folder: string): Promise<string[]> {
  const output = await git.attempt(["ls-tree", "-r", "-z", "--name-only", "HEAD", "--", folder]);
  return (output ?? "").split("\0").filter(Boolean);
}
