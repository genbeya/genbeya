/** Git's rules for branch and tag names (`git check-ref-format`), for the in-memory repository. */

/** Whether Git accepts `name` below `refs/heads/` or `refs/tags/`. */
export function isValidRefName(name: string): boolean {
  if (!name || name === "@" || name.startsWith("/") || name.endsWith("/") || name.endsWith(".")) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000- \u007f~^:?*[\\]|\.\.|@\{|\/\//.test(name)) return false;
  return name.split("/").every((part) => !part.startsWith(".") && !part.endsWith(".lock"));
}

/** Whether Git accepts `name` for a branch: a valid ref name that is neither HEAD nor reads as an option. */
export const isValidBranchName = (name: string): boolean => isValidRefName(name) && name !== "HEAD" && !name.startsWith("-");
