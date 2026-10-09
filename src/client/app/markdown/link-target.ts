/** Where a Markdown link points, resolved against the file that contains it. */
export type LinkTarget =
  | { readonly kind: "anchor"; readonly id: string }
  | { readonly kind: "external"; readonly url: string }
  | { readonly kind: "missing"; readonly title: string }
  | { readonly kind: "file"; readonly path: string; readonly anchor: string | undefined };

/** Links to wiki pages that do not exist yet; following one offers to create it. */
export const MISSING_PAGE = "gitdesk-missing:";

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
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) return { kind: "external", url: href };
  const [target = "", anchor] = href.split("#");
  const decoded = decode(target);
  // Absolute links start at the repository root; nothing climbs above it.
  const segments = decoded.startsWith("/") ? [] : from.split("/").slice(0, -1);
  for (const part of decoded.split("/")) {
    if (part === "..") segments.pop();
    else if (part && part !== ".") segments.push(part);
  }
  return { kind: "file", path: segments.join("/"), anchor: anchor ? decode(anchor) : undefined };
}
