// node scripts/serve-demo.mjs [port]: serves the web demo's build (dist/demo/browser, from
// `npm run build:demo`) at http://127.0.0.1:<port>/try/, the path genbeya.fyi hosts it under,
// for the demo's end-to-end tests and a look in the browser. Static files only. With --isolated,
// the page is cross-origin isolated (COOP and COEP), as wasm-git's threaded build needs.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

const port = Number(process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? 4200);
const isolation = process.argv.includes("--isolated")
  ? { "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "require-corp" }
  : {};
const root = path.resolve("dist/demo/browser");
const base = "/try/";
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

if (!existsSync(path.join(root, "index.html"))) {
  console.error(`${root} has no index.html. Run npm run build:demo first.`);
  process.exit(1);
}

createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname === "/" || url.pathname === base.slice(0, -1)) {
    response.writeHead(302, { location: base }).end();
    return;
  }
  const relative = url.pathname.startsWith(base) ? decodeURIComponent(url.pathname.slice(base.length)) || "index.html" : null;
  const file = relative === null ? null : path.join(root, relative);
  if (!file || !file.startsWith(root + path.sep) || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404, { "content-type": "text/plain" }).end("Not found");
    return;
  }
  response.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", ...isolation });
  createReadStream(file).pipe(response);
}).listen(port, "127.0.0.1", () => console.log(`The web demo is at http://127.0.0.1:${port}${base}`));
