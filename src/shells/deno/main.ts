/**
 * The Deno Desktop shell: the managers on Deno's Node compatibility layer,
 * the client in the system webview, and two bindings between them.
 * Bundled by scripts/build-backend.mjs, then compiled with `deno desktop`.
 */
import { spawn } from "node:child_process";
import { DENO_UNSAVED_CHECK, SHELL_OPERATIONS, type ShellOperation } from "../../contracts/bridges";
import { dispatch } from "../../contracts/rpc";
import { locationOfFolder } from "../../access/hosts/host-factory";
import { createBackend } from "../../managers/backend";
import { nodeMachine } from "../../platforms/node/node-machine";
import { CONTENT_SECURITY_POLICY } from "../content-security-policy";
import { CONTENT_TYPES, resolveClientFile } from "./static-files";

const CLIENT = new URL("../client/browser/", import.meta.url);

// WebView2 keeps its profile next to the executable, which an installed app cannot write to, unless
// WEBVIEW2_USER_DATA_FOLDER names another folder. Deno Desktop creates the webview before this code
// runs, so setting the variable here is too late: the app starts again with it set, and this
// instance ends. Its own webview fails without a window. (Deno hides spawned windows by default.)
// The profile is not taken over from GitDesk Deno, as the app was called before 0.5: it holds caches,
// and storage for an origin with a new random port on every start.
if (Deno.build.os === "windows" && !Deno.env.get("WEBVIEW2_USER_DATA_FOLDER")) {
  spawn(Deno.execPath(), Deno.args, {
    env: { ...Deno.env.toObject(), WEBVIEW2_USER_DATA_FOLDER: `${Deno.env.get("LOCALAPPDATA")}\\Genbeya Deno\\WebView2` },
    detached: true,
    windowsHide: false,
    stdio: "ignore",
  }).unref();
  Deno.exit(0);
}

// Deno Desktop serves this on a random loopback port and points the window at it.
Deno.serve(async (request) => {
  const file = request.method === "GET" ? resolveClientFile(CLIENT, new URL(request.url).pathname) : null;
  if (!file) return new Response("Not found", { status: 404 });
  try {
    return new Response(await Deno.readFile(file), {
      headers: {
        "content-type": CONTENT_TYPES[file.pathname.split(".").pop()!] ?? "application/octet-stream",
        "content-security-policy": CONTENT_SECURITY_POLICY,
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
});

/** What `command` prints; rejects when it cannot run, so a missing dialog tool is reported, not taken for a cancel. */
function output(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    const decoder = new TextDecoder();
    let text = "";
    child.stdout.on("data", (chunk: Uint8Array) => (text += decoder.decode(chunk, { stream: true })));
    child.on("error", () => reject(new Error(`Can't show a folder dialog: ${command} is not available.`)));
    child.on("close", () => resolve((text + decoder.decode()).trim()));
  });
}

/** Deno Desktop has no folder dialog yet, so the operating system's is used. */
function pickFolder(): Promise<string> {
  if (Deno.build.os === "windows")
    return output("powershell.exe", [
      "-NoProfile",
      "-STA",
      "-Command",
      // UTF-8 output, so folder names outside the console's code page survive.
      "[Console]::OutputEncoding = [Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; " +
        "$d.Description = 'Open a repository'; $d.UseDescriptionForTitle = $true; if ($d.ShowDialog() -eq 'OK') { [Console]::Out.Write($d.SelectedPath) }",
    ]);
  if (Deno.build.os === "darwin") return output("osascript", ["-e", 'POSIX path of (choose folder with prompt "Open a repository")']);
  return output("zenity", ["--file-selection", "--directory", "--title=Open a repository"]);
}

function openExternal(url: unknown): void {
  if (typeof url !== "string" || !/^(https?:|mailto:)/i.test(url)) throw new Error("Only web and mail links open externally.");
  const [command, args] =
    Deno.build.os === "windows"
      ? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]]
      : Deno.build.os === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  spawn(command, args, { windowsHide: true, detached: true, stdio: "ignore" }).unref();
}

/** The app's settings folder, named as the installers name the app (`linux` for Linux). */
const settingsFolder = (name: string, linux: string) =>
  Deno.build.os === "windows"
    ? `${Deno.env.get("APPDATA")}\\${name}`
    : Deno.build.os === "darwin"
      ? `${Deno.env.get("HOME")}/Library/Application Support/${name}`
      : `${Deno.env.get("XDG_CONFIG_HOME") ?? `${Deno.env.get("HOME")}/.config`}/${linux}`;
const dataFolder = settingsFolder("Genbeya Deno", "genbeya-deno");
/** GitDesk Deno's, whose recent repositories and preferences a first start takes over. */
const previousFolder = settingsFolder("GitDesk Deno", "gitdesk-deno");

// A failure nobody awaited (a background save) is reported, not fatal: Deno would otherwise end the app.
addEventListener("unhandledrejection", (event) => {
  event.preventDefault();
  console.error("Genbeya:", event.reason);
});

// node-pty loads under Deno, but opens its Windows pipes with fs calls Deno does not support, and
// `deno desktop` cannot bundle native modules; the client says the terminal is not available.
const backend = await createBackend({ ...nodeMachine(), terminals: null }, dataFolder, { folders: [previousFolder] });
const window = new Deno.BrowserWindow({ title: "Genbeya", width: 1440, height: 920 });

const operations: Record<ShellOperation, (...args: unknown[]) => Promise<unknown>> = {
  pickFolder: async () => {
    const folder = await pickFolder();
    return folder ? locationOfFolder(folder) : null;
  },
  openExternal: async (url) => openExternal(url),
  setTitle: async (title) => window.setTitle(typeof title === "string" && title.length < 300 ? title : "Genbeya"),
  // The webview follows the system theme; Deno Desktop cannot change it.
  setTheme: async () => undefined,
  launchArgs: async () => Deno.args,
};

window.bind("genbeya", (request: unknown) => dispatch(backend, request));
window.bind("genbeyaShell", (request: { operation?: unknown; args?: unknown }) => {
  if (!SHELL_OPERATIONS.includes(request?.operation as ShellOperation)) throw new Error("Unknown shell operation.");
  return operations[request.operation as ShellOperation](...(Array.isArray(request.args) ? request.args : []));
});

// Closing asks the page about unsaved changes, then the user.
let closing = false;
window.addEventListener("close", async (event: Event) => {
  if (closing) return;
  event.preventDefault();
  const discard = await window
    .executeJs(`!globalThis.${DENO_UNSAVED_CHECK}?.() || confirm("You have unsaved changes. Close anyway and discard them?")`)
    .catch(() => true);
  if (!discard) return;
  closing = true;
  await backend.dispose();
  Deno.exit(0);
});
