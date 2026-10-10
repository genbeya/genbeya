/**
 * Repository-relative paths as clients send them: slash-separated, inside the
 * working tree, never into `.git`. Validation happens at every manager entry
 * point, because clients are not trusted to send well-formed paths.
 */

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;
const MAX_LENGTH = 4096;

/**
 * Windows drops trailing dots and spaces and resolves 8.3 short names, so
 * `.git.`, `.git ` and `GIT~1` all reach `.git`; `:` selects NTFS streams.
 */
function unsafeSegment(segment: string, windows: boolean): boolean {
  if (!segment || segment === "." || segment === "..") return true;
  if (segment.replace(/[. ]+$/, "").toLowerCase() === ".git") return true;
  return (
    windows &&
    (/^git~\d+$/i.test(segment) ||
      /[. ]$/.test(segment) ||
      // eslint-disable-next-line no-control-regex
      /[:<>"|?*\x00-\x1f]/.test(segment) ||
      WINDOWS_RESERVED.test(segment))
  );
}

/** Returns the path unchanged when it is a safe repository-relative path; throws otherwise. */
export function validateRepositoryPath(value: unknown, windows: boolean): string {
  if (typeof value !== "string" || value.length > MAX_LENGTH || value.includes("\0")) throw new Error("Invalid path.");
  if (
    value.startsWith("/") ||
    /^[a-z]:/i.test(value) ||
    value.includes("\\") ||
    value.split("/").some((segment) => unsafeSegment(segment, windows))
  )
    throw new Error(`${value || "This path"} is not a valid path inside the repository.`);
  return value;
}

/** True when `path` lies below `root` (a folder path; "" is the repository root). */
export const within = (path: string, root: string): boolean => root === "" || root === "." || path.startsWith(root + "/");

export const parentOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf("/")));

export const baseName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/**
 * The repository path a link in the file `from` points to: relative to its
 * folder, or to the repository root when it starts with `/`. Nothing climbs
 * above the root.
 */
export function resolveLinkPath(from: string, target: string): string {
  const segments = target.startsWith("/") ? [] : from.split("/").slice(0, -1);
  for (const part of target.split("/")) {
    if (part === "..") segments.pop();
    else if (part && part !== ".") segments.push(part);
  }
  return segments.join("/");
}

/** The relative link from the file `from` to the path `to`. */
export function relativeLinkPath(from: string, to: string): string {
  const folder = from.split("/").slice(0, -1);
  const target = to.split("/");
  let shared = 0;
  while (shared < folder.length && shared < target.length - 1 && folder[shared] === target[shared]) shared++;
  return [...folder.slice(shared).map(() => ".."), ...target.slice(shared)].join("/");
}

/** Where `path` is after `moves` (entries moved from → to, with everything below them); null when it stays. */
export function relocate(path: string, moves: readonly (readonly [string, string])[]): string | null {
  for (const [from, to] of moves) if (path === from || within(path, from)) return to + path.slice(from.length);
  return null;
}
