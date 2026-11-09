/**
 * The address of a repository on a forge, as genbeya.fyi spells it: the forge, then the repository the way
 * the forge's own website spells it, so replacing `github.com` with `genbeya.fyi/github` (or `gitlab.com` with
 * `genbeya.fyi/gitlab`, …) in a repository's address opens it in Genbeya.
 *
 * | Forge | Address | A branch |
 * | --- | --- | --- |
 * | GitHub | `/github/<owner>/<repo>` | `/tree/<branch>` |
 * | GitLab | `/gitlab/<group>[/<subgroup>…]/<project>` | `/-/tree/<branch>` |
 * | Bitbucket Cloud | `/bitbucket/<workspace>/<repo>` | `/src/<branch>` or `/tree/<branch>` |
 * | Codeberg | `/codeberg/<owner>/<repo>` | `/src/branch/<branch>` or `/tree/<branch>` |
 * | Gitea, Forgejo | `/gitea/<owner>/<repo>?host=<host>`, `/forgejo/…` | as Codeberg |
 *
 * GitLab, Gitea and Forgejo run on servers of their own too: `?host=<host>` names one (GitLab's default is
 * gitlab.com). Wherever the page is served, `?forge=…&repo=…&branch=…&host=…` names a repository as well.
 */

export const FORGES = ["github", "gitlab", "bitbucket", "codeberg", "gitea", "forgejo"] as const;
export type Forge = (typeof FORGES)[number];

export interface ForgeAddress {
  readonly forge: Forge;
  /** The forge's website, such as `gitlab.com`, or a self-hosted server's host name. */
  readonly host: string;
  /** The owner: a user, an organisation, a workspace, or GitLab's group path (`group/subgroup`). */
  readonly owner: string;
  readonly name: string;
  /** The repository's default branch when missing. */
  readonly branch?: string;
}

/** Where each forge lives, unless the address names a server of its own. */
export const FORGE_HOSTS: Readonly<Record<Forge, string | null>> = {
  github: "github.com",
  gitlab: "gitlab.com",
  bitbucket: "bitbucket.org",
  codeberg: "codeberg.org",
  gitea: null,
  forgejo: null,
};

export const FORGE_LABELS: Readonly<Record<Forge, string>> = {
  github: "GitHub",
  gitlab: "GitLab",
  bitbucket: "Bitbucket",
  codeberg: "Codeberg",
  gitea: "Gitea",
  forgejo: "Forgejo",
};

/** The hosts a page reading `address` connects to: the forge's API, and GitHub's raw files. */
export function forgeConnectHosts({ forge, host }: Pick<ForgeAddress, "forge" | "host">): string[] {
  if (forge === "github") return ["api.github.com", "raw.githubusercontent.com"];
  if (forge === "bitbucket") return ["api.bitbucket.org"];
  return [host];
}

/** Forges that run on servers of their own. */
export const SELF_HOSTED: readonly Forge[] = ["gitlab", "gitea", "forgejo"];

/** GitHub's rules for user and organisation names. */
const GITHUB_OWNER = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;
/** GitHub's and Gitea's rules for repository names. */
const NAME = /^[\w.-]{1,100}$/;
/** A segment of a GitLab path: letters, digits, `_`, `-` and `.`, not starting with `-` or `.`. */
const GITLAB_SEGMENT = /^[a-z\d_][\w.-]{0,254}$/i;
const BITBUCKET_WORKSPACE = /^[a-z\d_-]{1,62}$/i;
const BITBUCKET_NAME = /^[\w.-]{1,62}$/;
const GITEA_OWNER = /^[\w.-]{1,40}$/;
/** A host name with at least two labels, and optionally a port. No IP addresses, no user names, no paths. */
const HOST = /^(?=.{1,253}(?::\d{1,5})?$)(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z][a-z\d-]{0,61}[a-z\d](?::\d{1,5})?$/;

const notDots = (value: string) => value !== "." && value !== "..";

export const isOwnerName = (value: string): boolean => GITHUB_OWNER.test(value);
export const isRepositoryName = (value: string): boolean => NAME.test(value) && notDots(value);
export const isHostName = (value: string): boolean => HOST.test(value) && Number(value.split(":")[1] ?? 443) <= 65535;

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

/** Whether `owner` and `name` are a repository's names on `forge`. */
export function isRepository(forge: Forge, owner: string, name: string): boolean {
  switch (forge) {
    case "github":
      return isOwnerName(owner) && isRepositoryName(name);
    case "gitlab":
      return [...owner.split("/"), name].every(
        (segment) => GITLAB_SEGMENT.test(segment) && !segment.endsWith(".git") && !segment.endsWith(".atom"),
      );
    case "bitbucket":
      return BITBUCKET_WORKSPACE.test(owner) && BITBUCKET_NAME.test(name) && notDots(name);
    default:
      return GITEA_OWNER.test(owner) && notDots(owner) && isRepositoryName(name);
  }
}

/** The repository `pathname` (percent-encoded, as `location.pathname`) and `search` name; null when they name none. */
export function parseForgeAddress(pathname: string, search = ""): ForgeAddress | null {
  const query = new URLSearchParams(search);
  const fromPath = /\/(github|gitlab|bitbucket|codeberg|gitea|forgejo)\/(.+?)\/?$/.exec(pathname);
  if (fromPath) {
    const segments = fromPath[2]!.split("/").map(decode);
    if (segments.some((segment) => segment === null)) return null;
    return address(fromPath[1] as Forge, ...splitPath(fromPath[1] as Forge, segments as string[]), query.get("host"));
  }
  const repository = query.get("repo");
  if (repository === null) return null;
  const forge = (query.get("forge") ?? "github") as Forge;
  if (!FORGES.includes(forge)) return null;
  const segments = repository.split("/");
  const name = segments.pop() ?? "";
  return address(forge, segments.join("/"), name.replace(/\.git$/, ""), query.get("branch") ?? undefined, query.get("host"));
}

/** Owner, name and branch from the path after the forge, in the forge's own spelling. */
function splitPath(forge: Forge, segments: string[]): [string, string, string | undefined] {
  const marker = forge === "gitlab" ? ["-", "tree"] : null;
  let end = segments.length;
  let branch: string | undefined;
  if (marker) {
    const at = segments.findIndex((segment, index) => segment === "-" && segments[index + 1] === "tree");
    if (at >= 0) [end, branch] = [at, segments.slice(at + 2).join("/") || undefined];
  } else if (segments.length > 2) {
    const [, , kind, ...rest] = segments;
    end = 2;
    if (kind === "tree" || (forge === "bitbucket" && kind === "src")) branch = rest.join("/");
    else if (kind === "src" && rest[0] === "branch") branch = rest.slice(1).join("/");
    else branch = "\0";
  }
  const name = (segments[end - 1] ?? "").replace(/\.git$/, "");
  return [segments.slice(0, end - 1).join("/"), name, branch === "" ? "\0" : branch];
}

function address(forge: Forge, owner: string, name: string, branch: string | undefined, hostParameter: string | null): ForgeAddress | null {
  const host = hostParameter === null ? FORGE_HOSTS[forge] : SELF_HOSTED.includes(forge) ? hostParameter.toLowerCase() : null;
  if (!host || !isHostName(host)) return null;
  if (!owner || !isRepository(forge, owner, name)) return null;
  if (forge !== "gitlab" && owner.includes("/")) return null;
  if (branch !== undefined && !isBranchName(branch)) return null;
  return { forge, host, owner, name, ...(branch === undefined ? {} : { branch }) };
}

/** Whether `address` names a server of its own rather than the forge's website. */
export const isSelfHosted = (address: Pick<ForgeAddress, "forge" | "host">): boolean => address.host !== FORGE_HOSTS[address.forge];

/** The path, and the query naming a server of its own, that opens `address`. */
export function forgeAddressPath(address: ForgeAddress): string {
  const { forge, owner, name, branch } = address;
  const encode = (path: string) => path.split("/").map(encodeURIComponent).join("/");
  const tree = branch === undefined ? "" : `${forge === "gitlab" ? "/-/tree/" : "/tree/"}${encode(branch)}`;
  const host = isSelfHosted(address) ? `?host=${encodeURIComponent(address.host)}` : "";
  return `/${forge}/${encode(owner)}/${encodeURIComponent(name)}${tree}${host}`;
}

/** The repository's page on its forge's website. */
export function forgeWebUrl(address: ForgeAddress): string {
  const { forge, host, owner, name, branch } = address;
  const encode = (path: string) => path.split("/").map(encodeURIComponent).join("/");
  const base = `https://${host}/${encode(owner)}/${encodeURIComponent(name)}`;
  if (branch === undefined) return base;
  if (forge === "gitlab") return `${base}/-/tree/${encode(branch)}`;
  if (forge === "bitbucket") return `${base}/src/${encode(branch)}`;
  if (forge === "github") return `${base}/tree/${encode(branch)}`;
  return `${base}/src/branch/${encode(branch)}`;
}

function decode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}
