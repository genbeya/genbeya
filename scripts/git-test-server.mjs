/**
 * A local Git server for the web demo's experiment with real repositories
 * (wiki: Architecture/Demo-real-repositories): serves the bare repositories
 * in a folder over smart HTTP with `git http-backend`, allows pushing, and
 * sends CORS headers, as wasm-git's playground does but without its sign-in.
 *
 *   node scripts/git-test-server.mjs <folder> [port]   (default 8788)
 *
 * Listens on 127.0.0.1 only, without authentication: for trying pushes
 * from the demo, never for anything else.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? ".");
const port = Number(process.argv[3] ?? 8788);

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, accept, content-encoding, git-protocol",
};

createServer((request, response) => {
  if (request.method === "OPTIONS") return void response.writeHead(204, cors).end();
  const url = new URL(request.url ?? "/", "http://localhost");
  const backend = spawn("git", ["http-backend"], {
    env: {
      ...process.env,
      GIT_PROJECT_ROOT: root,
      GIT_HTTP_EXPORT_ALL: "1",
      // Pushing without a signed-in user, for this test server only.
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "http.receivepack",
      GIT_CONFIG_VALUE_0: "true",
      PATH_INFO: decodeURIComponent(url.pathname),
      QUERY_STRING: url.search.slice(1),
      REQUEST_METHOD: request.method ?? "GET",
      CONTENT_TYPE: request.headers["content-type"] ?? "",
      REMOTE_ADDR: "127.0.0.1",
    },
  });
  request.pipe(backend.stdin);
  let head = Buffer.alloc(0);
  let headersDone = false;
  backend.stdout.on("data", (chunk) => {
    if (headersDone) return void response.write(chunk);
    head = Buffer.concat([head, chunk]);
    const end = head.indexOf("\r\n\r\n");
    if (end < 0) return;
    headersDone = true;
    const headers = { ...cors };
    let status = 200;
    for (const line of head.subarray(0, end).toString("latin1").split("\r\n")) {
      const colon = line.indexOf(":");
      const name = line.slice(0, colon).trim().toLowerCase();
      const value = line.slice(colon + 1).trim();
      if (name === "status") status = Number.parseInt(value, 10);
      else headers[name] = value;
    }
    response.writeHead(status, headers);
    response.write(head.subarray(end + 4));
  });
  backend.stderr.on("data", (chunk) => process.stderr.write(chunk));
  backend.on("close", () => {
    if (!headersDone) response.writeHead(502, cors);
    response.end();
    console.log(`${request.method} ${url.pathname}${url.search} → ${response.statusCode}`);
  });
}).listen(port, "127.0.0.1", () => console.log(`Git repositories in ${root} at http://127.0.0.1:${port}/<name>.git`));
