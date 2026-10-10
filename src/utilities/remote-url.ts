/**
 * Remote URLs: which repository they name, whatever form they take (https,
 * ssh, `git@host:owner/repo.git`, Azure DevOps' own forms), and where its
 * files and commits are on the host's website.
 */

/** A repository on a Git server, independent of how a remote URL spells it. */
export interface RemoteRepository {
  /** Lower-case host name without user or port; `dev.azure.com` for every Azure DevOps form. */
  readonly host: string;
  /** The path on the host without `.git` or outer slashes: `acme/demo`, or `org/project/_git/repo` on Azure DevOps. */
  readonly path: string;
  /** How the host's website is reached: http only for remotes that use plain http. */
  readonly scheme: "http" | "https";
}

export type WebTarget =
  { readonly kind: "file"; readonly path: string; readonly branch: string } | { readonly kind: "commit"; readonly hash: string };

const MAX_LENGTH = 2048;
const SCHEMES = new Set(["https", "http", "ssh", "git", "git+ssh", "ssh+git"]);
/** `[user@]host:path`, Git's scp-like syntax. */
const SCP_LIKE = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/;

/**
 * True for Git's `<transport>::<address>`, which runs the program git-remote-<transport>
 * (`ext::` runs any command). No network remote is spelled like that.
 */
export const namesRemoteHelper = (url: string): boolean => /^[a-z][a-z0-9+.-]*::/i.test(url.trim());

/** The repository a remote URL names, or null for local paths and anything else no other machine can reach. */
export function parseRemote(url: string): RemoteRepository | null {
  const text = url.trim();
  // eslint-disable-next-line no-control-regex
  if (!text || text.length > MAX_LENGTH || /[\s\x00-\x1f]/.test(text) || text.startsWith("-") || namesRemoteHelper(text)) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(text)?.[1]?.toLowerCase();
  let host: string;
  let path: string;
  if (scheme) {
    if (!SCHEMES.has(scheme)) return null;
    try {
      const parsed = new URL(text);
      host = parsed.hostname;
      path = decodeURIComponent(parsed.pathname);
    } catch {
      return null;
    }
  } else {
    const match = SCP_LIKE.exec(text);
    // A single letter before the colon is a Windows drive.
    if (!match || match[1]!.length < 2) return null;
    [host, path] = [match[1]!, match[2]!];
  }
  host = host.toLowerCase();
  path = path.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
  // A host that starts with "-" would reach ssh as an option.
  if (!host || host.startsWith("-") || !path) return null;
  return { ...azure(host, path), scheme: scheme === "http" ? "http" : "https" };
}

/** Azure DevOps spells one repository four ways; all become `dev.azure.com/org/project/_git/repo`. */
function azure(host: string, path: string): Pick<RemoteRepository, "host" | "path"> {
  const ssh = /^v3\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(path);
  if (ssh && (host === "ssh.dev.azure.com" || host === "vs-ssh.visualstudio.com"))
    return { host: "dev.azure.com", path: `${ssh[1]}/${ssh[2]}/_git/${ssh[3]}` };
  const organisation = /^([^.]+)\.visualstudio\.com$/.exec(host)?.[1];
  if (organisation) return { host: "dev.azure.com", path: `${organisation}/${path.replace(/^DefaultCollection\//i, "")}` };
  return { host, path };
}

/**
 * `url` without anything that may be secret: URLs lose their user name, password, query and
 * fragment, whatever the scheme. Git's scp-like form keeps a plain user such as `git@`, which
 * names the account on the server rather than a person, but loses a `user:password@`.
 */
export function withoutCredentials(url: string): string {
  const text = url.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return text.replace(/^[^@/\\\s]*:[^@/\\\s]*@/, "");
  try {
    const parsed = new URL(text);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.href;
  } catch {
    // Not a URL to `new URL`: drop everything up to the last @ of the authority, and the query.
    return text.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#]*@/i, "$1").replace(/[?#].*$/, "");
  }
}

/** True when both URLs name the same repository; hosts and paths compare without case, as Git hosts do. */
export function sameRepository(a: string, b: string): boolean {
  const [first, second] = [parseRemote(a), parseRemote(b)];
  return !!first && !!second && first.host === second.host && first.path.toLowerCase() === second.path.toLowerCase();
}

type Host = "github" | "gitlab" | "bitbucket" | "azure";

/** GitHub, GitLab (including self-hosted servers with "gitlab" in their name), Bitbucket Cloud and Azure DevOps. */
function hostOf({ host }: RemoteRepository): Host | null {
  if (host === "github.com") return "github";
  if (host.includes("gitlab")) return "gitlab";
  if (host === "bitbucket.org") return "bitbucket";
  return host === "dev.azure.com" ? "azure" : null;
}

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");
const encodeQuery = (value: string) => encodeURIComponent(value).replace(/%2F/g, "/");

/** The page of a file on a branch, or of a commit, on the host's website; null for hosts GitDesk does not know. */
export function webUrl(remote: string, target: WebTarget): string | null {
  const repository = parseRemote(remote);
  const host = repository && hostOf(repository);
  if (!repository || !host) return null;
  const base = `${repository.scheme}://${repository.host}/${encodePath(repository.path)}`;
  if (target.kind === "commit") {
    const commit = { github: "commit", gitlab: "-/commit", bitbucket: "commits", azure: "commit" }[host];
    return `${base}/${commit}/${target.hash}`;
  }
  if (host === "azure") return `${base}?path=${encodeQuery(`/${target.path}`)}&version=GB${encodeQuery(target.branch)}`;
  const blob = { github: "blob", gitlab: "-/blob", bitbucket: "src" }[host];
  return `${base}/${blob}/${encodePath(target.branch)}/${encodePath(target.path)}`;
}
