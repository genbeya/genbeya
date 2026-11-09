// node scripts/serve-github.mjs [port]: serves Genbeya on GitHub's build (dist/github/browser, from
// `npm run build:github`) the way genbeya.fyi does: its files below /github/_app/, and its page for every
// other address below /github/, such as /github/<owner>/<repo>. Static files only; the page itself asks GitHub.
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

const port = Number(process.argv[2] ?? 4200);
const root = path.resolve("dist/github/browser");
const assets = "/github/_app/";
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

if (!existsSync(path.join(root, "index.html"))) {
  console.error(`${root} has no index.html. Run npm run build:github first.`);
  process.exit(1);
}

/** The page, with its files' relative addresses made absolute: the page itself is served at many depths. */
export const page = (html, base) => html.replace(/\b(src|href)="(?![a-z][a-z0-9+.-]*:|\/|#)([^"]+)"/gi, `$1="${base}$2"`);
const index = page(readFileSync(path.join(root, "index.html"), "utf8"), assets);

createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname === "/" || url.pathname === "/github") {
    response.writeHead(302, { location: "/github/" }).end();
    return;
  }
  if (url.pathname.startsWith(assets)) {
    const file = path.join(root, decodeURIComponent(url.pathname.slice(assets.length)));
    if (!file.startsWith(root + path.sep) || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404, { "content-type": "text/plain" }).end("Not found");
      return;
    }
    response.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(response);
    return;
  }
  if (url.pathname.startsWith("/github/")) {
    response.writeHead(200, { "content-type": TYPES[".html"], "cache-control": "no-store" }).end(index);
    return;
  }
  response.writeHead(404, { "content-type": "text/plain" }).end("Not found");
}).listen(port, "127.0.0.1", () => console.log(`Genbeya on GitHub: http://127.0.0.1:${port}/github/`));
