/**
 * The address of a GitHub repository on genbeya.fyi: `/github/<owner>/<repo>`, or with a branch
 * `/github/<owner>/<repo>/tree/<branch>`, as GitHub spells a branch's page, so replacing `github.com`
 * with `genbeya.fyi/github` in a repository's address opens it in Genbeya. Wherever the page is served
 * from, `?repo=<owner>/<repo>&branch=<branch>` names one too.
 */

export interface GitHubAddress {
  readonly owner: string;
  readonly name: string;
  /** The repository's default branch when missing. */
  readonly branch?: string;
}

/** GitHub's rules for user and organisation names. */
const OWNER = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;
/** GitHub's rules for repository names. */
const NAME = /^[\w.-]{1,100}$/;

export const isOwnerName = (value: string): boolean => OWNER.test(value);
export const isRepositoryName = (value: string): boolean => NAME.test(value) && value !== "." && value !== "..";

/** Branch names as Git allows them (`git check-ref-format --branch`), up to 255 characters. */
export function isBranchName(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 255 &&
    // eslint-disable-next-line no-control-regex
    !/[\x00-\x20\x7f~^:?*[\\]|\.\.|@\{|\/\/|^[/.-]|[/.]$|\.lock$|^@$/.test(value) &&
    !value.split("/").some((part) => part.startsWith("."))
  );
}

/** The repository `pathname` (percent-encoded, as `location.pathname`) or else `search` names; null when neither does. */
export function parseGitHubAddress(pathname: string, search = ""): GitHubAddress | null {
  const fromPath = /\/github\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/tree\/(.+?))?\/?$/.exec(pathname);
  const query = new URLSearchParams(search);
  const named = query.get("repo");
  let parts: [string, string, string | undefined] | null = null;
  if (fromPath) parts = [decode(fromPath[1]!), decode(fromPath[2]!), fromPath[3] === undefined ? undefined : decode(fromPath[3])];
  else if (named) {
    const [owner = "", name = "", ...rest] = named.split("/");
    if (rest.length) return null;
    parts = [owner, name.replace(/\.git$/, ""), query.get("branch") ?? undefined];
  }
  if (!parts) return null;
  const [owner, name, branch] = parts;
  if (!isOwnerName(owner) || !isRepositoryName(name) || (branch !== undefined && !isBranchName(branch))) return null;
  return branch === undefined ? { owner, name } : { owner, name, branch };
}

/** The path below the site's root that opens `address`. */
export function gitHubAddressPath({ owner, name, branch }: GitHubAddress): string {
  const tree = branch === undefined ? "" : `/tree/${branch.split("/").map(encodeURIComponent).join("/")}`;
  return `/github/${encodeURIComponent(owner)}/${encodeURIComponent(name)}${tree}`;
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return "";
  }
}
