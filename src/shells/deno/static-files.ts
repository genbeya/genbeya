/** Maps request paths to files of the built client, refusing anything outside it. */

export const CONTENT_TYPES: Readonly<Record<string, string>> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript",
  css: "text/css",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  ico: "image/x-icon",
  woff2: "font/woff2",
  wasm: "application/wasm",
};

export function resolveClientFile(root: URL, pathname: string): URL | null {
  let relative: string;
  try {
    relative = decodeURIComponent(pathname).replace(/^\/+/, "") || "index.html";
  } catch {
    return null;
  }
  if (relative.split("/").some((segment) => segment === ".." || segment === ".") || /[\\\0:]/.test(relative)) return null;
  const file = new URL(relative, root);
  return file.href.startsWith(root.href) ? file : null;
}
