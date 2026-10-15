/**
 * A CORS relay for the web demo's experiment with real repositories
 * (wiki: Architecture/Demo-real-repositories). Git servers such as GitHub
 * don't allow requests from web pages, so the demo clones through this:
 * `<relay>/<host>/<path>` forwards Git's smart HTTP fetch requests to
 * `https://<host>/<path>` and adds the CORS headers.
 *
 * Only fetching public repositories: the two upload-pack requests of a
 * clone or fetch, to known hosts, without credentials or cookies either
 * way. Pushing (receive-pack) and everything else is refused.
 *
 * The default export is a fetch handler, as a Cloudflare Worker exports
 * one; `node scripts/cors-relay.mjs [port]` runs it locally (default 8787).
 * It is not part of the app or the demo's build.
 */

/** Hosts the relay fetches from. */
const HOSTS = new Set(["github.com", "gitlab.com", "codeberg.org", "bitbucket.org"]);

/** Pages that may use the relay. */
const ORIGINS = [/^https:\/\/genbeya\.fyi$/, /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/];

/** What a clone or fetch asks for: the refs, then the pack. */
const ROUTES = [
  { method: "GET", pattern: /^\/([^/]+)\/(.+)\/info\/refs$/, query: "service=git-upload-pack" },
  { method: "POST", pattern: /^\/([^/]+)\/(.+)\/git-upload-pack$/ },
];

/** Request headers passed on; nothing that could carry credentials. */
const FORWARDED = ["accept", "content-type", "content-encoding", "git-protocol"];

const cors = (origin) => ({
  "access-control-allow-origin": origin,
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, accept, content-encoding, git-protocol",
  "access-control-max-age": "600",
  vary: "origin",
});

const refuse = (status, message, headers = {}) =>
  new Response(`${message}\n`, { status, headers: { "content-type": "text/plain", ...headers } });

const relay = {
  async fetch(request) {
    const url = new URL(request.url);
    const origin = request.headers.get("origin") ?? "";
    if (!ORIGINS.some((allowed) => allowed.test(origin))) return refuse(403, "This relay serves the Genbeya demo only.");
    const headers = cors(origin);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

    const route = ROUTES.find((candidate) => candidate.method === request.method && candidate.pattern.test(url.pathname));
    if (!route || (route.query && url.search !== `?${route.query}`)) return refuse(403, "The relay only fetches repositories.", headers);
    const [, host, path] = route.pattern.exec(url.pathname);
    if (!HOSTS.has(host)) return refuse(403, `The relay doesn't fetch from ${host}.`, headers);

    const forwarded = new Headers({ "user-agent": "git/2.47.0 (genbeya-demo-relay)" });
    for (const name of FORWARDED) if (request.headers.has(name)) forwarded.set(name, request.headers.get(name));
    const target = `https://${host}/${path}/${route.method === "GET" ? "info/refs" : "git-upload-pack"}${url.search}`;
    const response = await fetch(target, {
      method: request.method,
      headers: forwarded,
      body: request.method === "POST" ? request.body : undefined,
      // Node's fetch needs this to stream a request body.
      duplex: "half",
      redirect: "follow",
    });
    // A private repository asks for credentials; the relay has none to give.
    if (response.status === 401) return refuse(403, "The repository isn't public.", headers);
    const passed = new Headers(headers);
    for (const name of ["content-type", "cache-control"]) if (response.headers.has(name)) passed.set(name, response.headers.get(name));
    return new Response(response.body, { status: response.status, headers: passed });
  },
};

export default relay;

/** Serves the handler with Node's http module. */
async function serve(port) {
  const { createServer } = await import("node:http");
  const { Readable } = await import("node:stream");
  createServer(async (incoming, outgoing) => {
    try {
      const body =
        incoming.method === "GET" || incoming.method === "HEAD" || incoming.method === "OPTIONS" ? undefined : Readable.toWeb(incoming);
      const request = new Request(`http://${incoming.headers.host}${incoming.url}`, {
        method: incoming.method,
        headers: Object.entries(incoming.headers).filter(([, value]) => typeof value === "string"),
        body,
        duplex: "half",
      });
      const started = Date.now();
      const response = await relay.fetch(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      let bytes = 0;
      if (response.body)
        for await (const chunk of response.body) {
          bytes += chunk.length;
          outgoing.write(chunk);
        }
      outgoing.end();
      console.log(`${incoming.method} ${incoming.url} → ${response.status}, ${bytes} bytes in ${Date.now() - started} ms`);
    } catch (error) {
      console.error(error);
      if (!outgoing.headersSent) outgoing.writeHead(502, { "content-type": "text/plain" });
      outgoing.end("The relay couldn't reach the repository.\n");
    }
  }).listen(port, "127.0.0.1", () => console.log(`CORS relay for the Genbeya demo on http://127.0.0.1:${port}`));
}

// Run directly with Node, not imported (as a Worker's module is).
if (globalThis.process?.argv?.[1] && import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1]).href)
  await serve(Number(process.argv[2] ?? 8787));
