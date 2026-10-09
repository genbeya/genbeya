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

Deno.serve(async (request) => {
  const file = request.method === "GET" ? resolveClientFile(CLIENT, new URL(request.url).pathname) : null;
  if (!file) return new Response("Not found", { status: 404 });
  try {
    return new Response(await Deno.readFile(file), {
      headers: { "content-type": CONTENT_TYPES[file.pathname.split(".").pop()!] ?? "application/octet-stream", "content-security-policy": CONTENT_SECURITY_POLICY },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
});


function output(command: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true });
    let text = "";
    child.stdout.on("data", (chunk: Uint8Array) => (text += new TextDecoder().decode(chunk)));
    child.on("error", () => resolve(""));
    child.on("close", () => resolve(text.trim()));
  });
}

/** Deno Desktop has no folder dialog yet, so the operating system's is used. */
function pickFolder(): Promise<string> {
  if (Deno.build.os === "windows")
    return output("powershell.exe", [
      "-NoProfile",
      "-STA",
      "-Command",
      "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; " +
        "$d.Description = 'Open a repository'; $d.UseDescriptionForTitle = $true; if ($d.ShowDialog() -eq 'OK') { [Console]::Out.Write($d.SelectedPath) }",
    ]);
  if (Deno.build.os === "darwin") return output("osascript", ["-e", 'POSIX path of (choose folder with prompt "Open a repository")']);
  return output("zenity", ["--file-selection", "--directory", "--title=Open a repository"]);
}

function openExternal(url: unknown): void {
  if (typeof url !== "string" || !/^(https?:|mailto:)/i.test(url)) throw new Error("Only web and mail links open externally.");
  const [command, args] =
    Deno.build.os === "windows" ? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]] : Deno.build.os === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  spawn(command, args, { windowsHide: true, detached: true, stdio: "ignore" }).unref();
}

const dataFolder =
  Deno.build.os === "windows"
    ? `${Deno.env.get("APPDATA")}\\GitDesk Deno`
    : Deno.build.os === "darwin"
      ? `${Deno.env.get("HOME")}/Library/Application Support/GitDesk Deno`
      : `${Deno.env.get("XDG_CONFIG_HOME") ?? `${Deno.env.get("HOME")}/.config`}/gitdesk-deno`;

const backend = await createBackend(nodeMachine(), dataFolder);
const window = new Deno.BrowserWindow({ title: "GitDesk", width: 1440, height: 920 });

const operations: Record<ShellOperation, (...args: unknown[]) => Promise<unknown>> = {
  pickFolder: async () => {
    const folder = await pickFolder();
    return folder ? locationOfFolder(folder) : null;
  },
  openExternal: async (url) => openExternal(url),
  setTitle: async (title) => window.setTitle(typeof title === "string" && title.length < 300 ? title : "GitDesk"),
  // The webview follows the system theme; Deno Desktop cannot change it.
  setTheme: async () => undefined,
  launchArgs: async () => Deno.args,
};

window.bind("gitdesk", (request: unknown) => dispatch(backend, request));
window.bind("gitdeskShell", (request: { operation?: unknown; args?: unknown }) => {
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
