/**
 * `gitdesk://open?remote=<url>&task=<id>` and its siblings `page=`, `file=`
 * and `commit=`. Links come from outside (the clipboard, the operating
 * system), so parsing accepts only these keys, once each, with values that
 * name an item: never a local path as remote, never a path outside the
 * repository. Opening a link only shows the item.
 */
import { GITDESK_LINK_PREFIX, type GitdeskLink, type LinkItem } from "../contracts/gitdesk-link";
import { parseRemote, withoutCredentials } from "./remote-url";
import { validateRepositoryPath } from "./repository-path";

const MAX_LENGTH = 8192;
const LINK = /^gitdesk:\/\/open\/?\?([^#]*)$/i;
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const COMMIT = /^[0-9a-f]{7,64}$/i;

/** Values stay readable: slashes, colons and at signs need no escaping in a query. */
const encode = (value: string) => encodeURIComponent(value).replace(/%(2F|3A|40)/g, (escaped) => decodeURIComponent(escaped));

const valueOf = (item: LinkItem): string => (item.kind === "task" ? item.id : item.kind === "commit" ? item.hash : item.path);

/** The link to `link.item`; credentials in an http(s) remote URL are left out. */
export const formatGitdeskLink = ({ remote, item }: GitdeskLink): string =>
  `${GITDESK_LINK_PREFIX}?remote=${encode(withoutCredentials(remote))}&${item.kind}=${encode(valueOf(item))}`;

function itemOf(kind: string, value: string): LinkItem | null {
  const path = (check: (path: string) => boolean = () => true) => {
    try {
      return check(validateRepositoryPath(value, false)) ? value : null;
    } catch {
      return null;
    }
  };
  switch (kind) {
    case "task":
      return TASK_ID.test(value) ? { kind, id: value } : null;
    case "commit":
      return COMMIT.test(value) ? { kind, hash: value.toLowerCase() } : null;
    case "page": {
      const page = path((candidate) => candidate.endsWith(".md"));
      return page ? { kind, path: page } : null;
    }
    case "file": {
      const file = path();
      return file ? { kind, path: file } : null;
    }
    default:
      return null;
  }
}

/** The link `text` holds, or null when it is anything else or carries anything unexpected. */
export function parseGitdeskLink(text: unknown): GitdeskLink | null {
  if (typeof text !== "string" || text.length > MAX_LENGTH) return null;
  const query = LINK.exec(text.trim())?.[1];
  if (!query) return null;
  const values = new Map<string, string>();
  for (const pair of query.split("&")) {
    const separator = pair.indexOf("=");
    if (separator < 0) return null;
    const key = pair.slice(0, separator);
    if (values.has(key)) return null;
    try {
      values.set(key, decodeURIComponent(pair.slice(separator + 1)));
    } catch {
      return null;
    }
  }
  const remote = values.get("remote");
  values.delete("remote");
  const [entry, ...rest] = values;
  if (!remote || !parseRemote(remote) || !entry || rest.length) return null;
  const item = itemOf(...entry);
  return item && { remote, item };
}

/** "task GENBEYA-12", "page docs/Home.md", "file src/main.ts", "commit 1a2b3c4d". */
export const describeLinkItem = (item: LinkItem): string =>
  `${item.kind} ${item.kind === "commit" ? item.hash.slice(0, 8) : valueOf(item)}`;
