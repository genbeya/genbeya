import path from "node:path";
/** Resolve only bundled renderer assets; never serve repository or arbitrary disk files. */
export function resolveAsset(root: string, requestUrl: string): string {
  const url = new URL(requestUrl);
  if (url.protocol !== "gitdesk:" || url.host !== "app")
    throw new Error("Unknown app origin.");
  const pathname = decodeURIComponent(
    url.pathname === "/" ? "/index.html" : url.pathname,
  );
  if (pathname.includes("\\") || pathname.includes("\0"))
    throw new Error("Invalid asset path.");
  const file = path.resolve(root, "." + pathname);
  const relative = path.relative(root, file);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("Asset path escapes the bundle.");
  return file;
}
