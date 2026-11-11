// node scripts/serve-forge.mjs [port]: serves the forge build (dist/forge/browser, from `npm run build:forge`)
// the way genbeya.fyi will (GENBEYA-59): its files below /_app/, its page at / and at every forge address
// (/github/<owner>/<repo>, /gitlab/…, ?host=… for servers of their own), with a content security policy
// per address that allows connections only to that forge's hosts. Static files only.
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

const port = Number(process.argv[2] ?? 4200);
const root = path.resolve("dist/forge/browser");
const assets = "/_app/";
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
  console.error(`${root} has no index.html. Run npm run build:forge first.`);
  process.exit(1);
}

/** The page, with its files' relative addresses made absolute: the page itself is served at many depths. */
const page = readFileSync(path.join(root, "index.html"), "utf8").replace(
  /\b(src|href)="(?![a-z][a-z0-9+.-]*:|\/|#)([^"]+)"/gi,
  `$1="${assets}$2"`,
);

// As src/utilities/forge-address.ts (FORGE_HOSTS, SELF_HOSTED, isHostName) and forgeConnectHosts: keep in step.
const WEBSITES = {
  github: "github.com",
  gitlab: "gitlab.com",
  bitbucket: "bitbucket.org",
  codeberg: "codeberg.org",
  gitea: null,
  forgejo: null,
};
const SELF_HOSTED = new Set(["gitlab", "gitea", "forgejo"]);
const HOST = /^(?=.{1,253}(?::\d{1,5})?$)(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z][a-z\d-]{0,61}[a-z\d](?::\d{1,5})?$/;

/** The hosts the page at `url` may connect to: those of the forge it names, or none. */
function connectHosts(url) {
  const forge =
    /^\/(github|gitlab|bitbucket|codeberg|gitea|forgejo)\//.exec(url.pathname)?.[1] ??
    url.searchParams.get("forge") ??
    (url.searchParams.has("repo") ? "github" : null);
  if (!forge || !(forge in WEBSITES)) return [];
  const named = url.searchParams.get("host")?.toLowerCase();
  const host = named === undefined ? WEBSITES[forge] : SELF_HOSTED.has(forge) && HOST.test(named) ? named : null;
  if (!host) return [];
  if (forge === "github") return ["api.github.com", "raw.githubusercontent.com"];
  if (forge === "bitbucket") return ["api.bitbucket.org"];
  return [host];
}

/** The policy of index.forge.html, with connections only to `hosts`. */
const policy = (hosts) =>
  [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    `connect-src 'self'${hosts.map((host) => ` https://${host}`).join("")}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");

createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
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
  if (url.pathname === "/" || /^\/(github|gitlab|bitbucket|codeberg|gitea|forgejo)(\/|$)/.test(url.pathname)) {
    response
      .writeHead(200, {
        "content-type": TYPES[".html"],
        "cache-control": "no-store",
        "content-security-policy": policy(connectHosts(url)),
        "referrer-policy": "no-referrer",
      })
      .end(page);
    return;
  }
  response.writeHead(404, { "content-type": "text/plain" }).end("Not found");
}).listen(port, "127.0.0.1", () => console.log(`Genbeya on forges: http://127.0.0.1:${port}/`));
