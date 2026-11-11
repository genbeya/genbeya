/**
 * The committed history of every file below a folder at once, as the plan's
 * history needs it: each commit with the files it changed and their text
 * after it. One `git log` with whole-file patches, newest first.
 */
import { decodeLenient } from "../../utilities/bytes";
import type { Git } from "./git";
import { FILE_LOG_FORMAT, unquotePath } from "./git-parsers";

/** Context lines enough for patches to hold whole files. */
const WHOLE_FILE = 1_000_000;
/** Versions larger than this are left out, as binary files are. */
const VERSION_LIMIT = 256 * 1024;

export interface FolderCommit {
  readonly hash: string;
  readonly author: string;
  readonly date: string;
  readonly subject: string;
  /** The files the commit changed: their text after it, null where it deleted one. */
  readonly files: readonly { readonly path: string; readonly content: string | null }[];
}

export async function folderHistory(git: Git, folder: string, limit: number): Promise<FolderCommit[]> {
  const output = await git.attempt([
    "-c",
    `core.bigFileThreshold=${VERSION_LIMIT}`,
    "log",
    "--no-merges",
    "--no-renames",
    "--no-show-signature",
    `--max-count=${limit}`,
    `--format=${FILE_LOG_FORMAT}`,
    "--patch",
    `--unified=${WHOLE_FILE}`,
    "--no-ext-diff",
    "--no-textconv",
    "--",
    folder,
  ]);
  return parseFolderLog(output ?? "");
}

/** `git log --patch --unified=<whole> --format=FILE_LOG_FORMAT` of many files, newest first. */
export function parseFolderLog(output: string): FolderCommit[] {
  const commits: FolderCommit[] = [];
  let header: string[] | null = null;
  let files: { path: string; content: string | null }[] = [];
  let file: { path: string | null; deleted: boolean; lines: string[]; hunks: boolean } | null = null;
  const closeFile = () => {
    if (file?.path && (file.deleted || file.hunks))
      files.push({ path: file.path, content: file.deleted ? null : `${file.lines.join("\n")}\n` });
    file = null;
  };
  const closeCommit = () => {
    closeFile();
    if (header) {
      const [, hash, author, date, subject] = header;
      commits.push({ hash: hash!, author: author!, date: date!, subject: subject ?? "", files });
    }
    files = [];
  };
  for (const line of output.replace(/\n$/, "").split("\n")) {
    if (line.startsWith("\0")) {
      closeCommit();
      header = line.split("\0");
    } else if (line.startsWith("diff --git ")) {
      closeFile();
      file = { path: null, deleted: false, lines: [], hunks: false };
    } else if (!file) continue;
    else if (file.hunks) {
      // Every line of a hunk starts with its kind; "\" notes a missing final newline.
      if (line.startsWith("@@") || line.startsWith("\\") || line.startsWith("-")) continue;
      file.lines.push(line.slice(1));
    } else if (line.startsWith("deleted file mode")) file.deleted = true;
    else if (line.startsWith("--- ") && file.deleted) file.path = unquotePath(line.slice(4)).replace(/^a\//, "");
    else if (line.startsWith("+++ ") && line !== "+++ /dev/null") file.path = unquotePath(line.slice(4)).replace(/^b\//, "");
    else if (line.startsWith("@@")) file.hunks = true;
  }
  closeCommit();
  return commits;
}

/** The files below `folder` at `revision`, with their text; the commit is null when Git knows no such revision. */
export async function filesAt(
  git: Git,
  revision: string,
  folder: string,
): Promise<{ commit: string | null; files: { path: string; content: string }[] }> {
  const commit = await git.objectId(`${revision}^{commit}`);
  if (!commit) return { commit: null, files: [] };
  const listing = await git.attempt(["ls-tree", "-r", "-z", "--long", commit, "--", `${folder}/`]);
  const entries = (listing ?? "")
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const [info, path] = [entry.slice(0, entry.indexOf("\t")), entry.slice(entry.indexOf("\t") + 1)];
      const [, type, id, size] = info.split(/\s+/);
      return { type, id: id!, size: Number(size), path };
    })
    .filter((entry) => entry.type === "blob" && entry.path.toLowerCase().endsWith(".md") && entry.size <= VERSION_LIMIT);
  const files = await Promise.all(
    entries.map(async (entry) => ({ path: entry.path, content: decodeLenient(await git.bytes(["cat-file", "blob", entry.id])) })),
  );
  return { commit, files };
}
