/**
 * Builds the renderer for a non-Electron shell: `vite build -c desktop/vite.config.ts --mode deno|tauri`.
 * The shell's web.ts runs first and installs window.gitdesk. For Tauri,
 * which has no JavaScript backend, the engine itself runs in the webview and
 * the Node modules it imports are provided by desktop/tauri/node/.
 */
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig, type Plugin } from "vite";
import base from "../vite.config";

const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

function shellEntry(shell: string): Plugin {
  // Tauri's IPC is a custom protocol (ipc: on macOS/Linux, http://ipc.localhost on Windows).
  const connect = shell === "tauri" ? "'self' ipc: http://ipc.localhost" : "'self'";
  return {
    name: "gitdesk-shell-entry",
    transformIndexHtml: {
      order: "pre",
      handler: (html) =>
        html
          .replace("%CONNECT_SRC%", connect)
          .replace(
            '<script type="module" src="/src/main.tsx"></script>',
            `<script type="module" src="/desktop/${shell}/web.ts"></script>\n    <script type="module" src="/src/main.tsx"></script>`,
          ),
    },
  };
}

const NODE_SHIMS = ["child_process", "fs", "path", "crypto", "zlib"];

export default defineConfig(({ mode: shell }) => {
  if (shell !== "deno" && shell !== "tauri") throw new Error("Build with --mode deno or --mode tauri.");
  return mergeConfig(base, {
    plugins: [shellEntry(shell)],
    build: { outDir: `dist-${shell}`, emptyOutDir: true },
    resolve:
      shell === "tauri"
        ? {
            alias: NODE_SHIMS.map((name) => ({
              find: new RegExp(`^(node:)?${name}$`),
              replacement: here(`./tauri/node/${name}.ts`),
            })),
          }
        : {},
  });
});
