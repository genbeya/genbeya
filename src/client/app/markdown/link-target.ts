import { resolveLinkPath } from "../../../utilities/repository-path";

/** Where a Markdown link points, resolved against the file that contains it. */
export type LinkTarget =
  | { readonly kind: "anchor"; readonly id: string }
  | { readonly kind: "external"; readonly url: string }
  | { readonly kind: "missing"; readonly title: string }
  /** An `@mention` of a person, by handle. */
  | { readonly kind: "person"; readonly handle: string }
  | { readonly kind: "file"; readonly path: string; readonly anchor: string | undefined };

/** Links to wiki pages that do not exist yet; following one offers to create it. */
export const MISSING_PAGE = "gitdesk-missing:";
/** Links of `@mentions`; following one shows who the person is. */
export const PERSON_LINK = "gitdesk-person:";

const decode = (text: string) => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

export function resolveHref(from: string, href: string): LinkTarget {
  if (href.startsWith("#")) return { kind: "anchor", id: decode(href.slice(1)) };
  if (href.startsWith(MISSING_PAGE)) return { kind: "missing", title: decode(href.slice(MISSING_PAGE.length)) };
  if (href.startsWith(PERSON_LINK)) return { kind: "person", handle: decode(href.slice(PERSON_LINK.length)) };
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) return { kind: "external", url: href };
  const [target = "", anchor] = href.split("#");
  return { kind: "file", path: resolveLinkPath(from, decode(target)), anchor: anchor ? decode(anchor) : undefined };
}
