/** Validation for the repository-relative, slash-separated paths the renderer sends. */

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

/**
 * Windows drops trailing dots and spaces and resolves 8.3 short names, so
 * `.git.`, `.git ` and `GIT~1` all reach `.git`; `:` selects NTFS streams.
 */
function unsafeSegment(segment: string, windows: boolean) {
  if (!segment || segment === "." || segment === "..") return true;
  if (segment.replace(/[. ]+$/, "").toLowerCase() === ".git") return true;
  return (
    windows &&
    (/^git~\d+$/i.test(segment) ||
      /[. ]$/.test(segment) ||
      /[:<>"|?*\x00-\x1f]/.test(segment) ||
      WINDOWS_RESERVED.test(segment))
  );
}

export function relativePath(value: unknown, windows: boolean): string {
  if (typeof value !== "string" || value.length > 4096 || value.includes("\0"))
    throw new Error("Invalid path.");
  if (
    value.startsWith("/") ||
    /^[a-z]:/i.test(value) ||
    value.includes("\\") ||
    value.split("/").some((segment) => unsafeSegment(segment, windows))
  )
    throw new Error(`${value || "This path"} is not a valid path inside the repository.`);
  return value;
}

export const within = (path: string, root: string) =>
  root === "" || root === "." || path.startsWith(root + "/");

export const parent = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));

export const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);
