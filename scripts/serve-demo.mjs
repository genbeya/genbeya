// node scripts/serve-demo.mjs [port] [folder] [base] [index]: serves the web demo's build
// (dist/demo/browser, from `npm run build:demo`) at http://127.0.0.1:<port>/try/, the path
// genbeya.fyi hosts it under, for the demo's end-to-end tests and a look in the browser. Static
// files only. The kit's tests serve dist/kit at /kit/ with it: `4418 dist/kit /kit/ kit.html`.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

const port = Number(process.argv[2] ?? 4200);
const root = path.resolve(process.argv[3] ?? "dist/demo/browser");
const base = process.argv[4] ?? "/try/";
const index = process.argv[5] ?? "index.html";
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

if (!existsSync(path.join(root, index))) {
  console.error(`${root} has no ${index}. Build it first (npm run build:demo, npm run build:kit).`);
  process.exit(1);
}

createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname === "/" || url.pathname === base.slice(0, -1)) {
    response.writeHead(302, { location: base }).end();
    return;
  }
  const relative = url.pathname.startsWith(base) ? decodeURIComponent(url.pathname.slice(base.length)) || index : null;
  const file = relative === null ? null : path.join(root, relative);
  if (!file || !file.startsWith(root + path.sep) || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404, { "content-type": "text/plain" }).end("Not found");
    return;
  }
  response.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(response);
}).listen(port, "127.0.0.1", () => console.log(`Serving ${path.relative(process.cwd(), root)} at http://127.0.0.1:${port}${base}`));
