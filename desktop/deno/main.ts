/**
 * GitDesk on Deno Desktop: the engine runs unchanged on Deno's Node
 * compatibility layer, the window is the system webview, and the renderer
 * reaches the engine through one in-process binding.
 *
 *   deno task desktop:dev     run from source
 *   deno task desktop:build   compile the app
 */
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";

// The engine uses Node's Buffer global, which Deno only provides to npm packages.
(globalThis as { Buffer?: unknown }).Buffer ??= Buffer;

const { DesktopSession, handle } = await import("../session.ts");
const { Store } = await import("../../electron/state.ts");

const DIST = new URL("../../dist-deno/", import.meta.url);
const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript",
  css: "text/css",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  woff2: "font/woff2",
  ttf: "font/ttf",
  wasm: "application/wasm",
};

Deno.serve(async (request) => {
  const url = new URL(request.url);
  const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
  if (request.method !== "GET" || relative.split("/").some((s) => s === ".." || s.includes("\\")))
    return new Response("Not found", { status: 404 });
  try {
    const body = await Deno.readFile(new URL(relative, DIST));
    return new Response(body, {
      headers: { "content-type": TYPES[relative.split(".").pop()!] ?? "application/octet-stream" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
});

const run = (command: string, args: string[]) =>
  new Promise<string>((resolve) => {
    const child = spawn(command, args, { windowsHide: true });
    let out = "";
    child.stdout.on("data", (chunk: Uint8Array) => (out += new TextDecoder().decode(chunk)));
    child.on("error", () => resolve(""));
    child.on("close", () => resolve(out.trim()));
  });

/** Deno Desktop has no folder dialog yet; ask the operating system directly. */
function pickFolder() {
  switch (Deno.build.os) {
    case "windows":
      return run("powershell.exe", [
        "-NoProfile", "-STA", "-Command",
        "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; " +
          "$d.Description = 'Open a repository'; $d.UseDescriptionForTitle = $true; " +
          "if ($d.ShowDialog() -eq 'OK') { [Console]::Out.Write($d.SelectedPath) }",
      ]);
    case "darwin":
      return run("osascript", ["-e", 'POSIX path of (choose folder with prompt "Open a repository")']);
    default:
      return run("zenity", ["--file-selection", "--directory", "--title=Open a repository"]);
  }
}

function openExternal(url: string) {
  const [command, args] =
    Deno.build.os === "windows" ? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]]
    : Deno.build.os === "darwin" ? ["open", [url]]
    : ["xdg-open", [url]];
  spawn(command, args, { windowsHide: true, detached: true, stdio: "ignore" }).unref();
  return Promise.resolve();
}

const dataDir =
  Deno.build.os === "windows" ? `${Deno.env.get("APPDATA")}\\GitDesk Deno`
  : Deno.build.os === "darwin" ? `${Deno.env.get("HOME")}/Library/Application Support/GitDesk Deno`
  : `${Deno.env.get("XDG_CONFIG_HOME") ?? `${Deno.env.get("HOME")}/.config`}/gitdesk-deno`;

const store = await Store.load(dataDir);
const window = new Deno.BrowserWindow({ title: "GitDesk", width: 1440, height: 920 });

const session = new DesktopSession(store, {
  pickFolder: async () => (await pickFolder()) || null,
  openExternal,
  setTitle: (title) => window.setTitle(title),
  // The webview follows the system theme; Deno Desktop cannot override it.
  setTheme: () => undefined,
  recentChanged: () => undefined,
  fetch,
  argv: Deno.args,
});

window.bind("gitdesk", (request: { method: string; args: unknown[] }) =>
  handle(session, request.method, Array.isArray(request.args) ? request.args : []),
);

// The renderer vetoes closing while edits are unsaved.
let closing = false;
window.addEventListener("close", async (event: Event) => {
  if (closing) return;
  event.preventDefault();
  const leave = await window
    .executeJs(
      "(() => { const e = new Event('beforeunload', { cancelable: true }); dispatchEvent(e);" +
        " return !e.defaultPrevented || confirm('You have unsaved changes. Close anyway and discard them?'); })()",
    )
    .catch(() => true);
  if (!leave) return;
  closing = true;
  await session.dispose();
  Deno.exit(0);
});
