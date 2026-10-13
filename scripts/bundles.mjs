// esbuild options of the shells that run the managers outside the webview, shared by the
// builds (build-backend.mjs, build-vscode.mjs) and the dev loop (dev.mjs).
// The Tauri shell needs no bundle: its managers run in the client (see src/client/app/platform).
// node-pty is a native module: it ships next to the bundle (Electron unpacks it from the asar archive).
const common = { bundle: true, logLevel: "warning", legalComments: "none", sourcemap: "linked", external: ["node-pty"] };

/** Electron main process and preload → dist/electron */
export const electronBundle = {
  ...common,
  entryPoints: { main: "src/shells/electron/main.ts", preload: "src/shells/electron/preload.ts" },
  outdir: "dist/electron",
  outExtension: { ".js": ".cjs" },
  platform: "node",
  format: "cjs",
  target: "node22",
  external: [...common.external, "electron"],
};

/** Deno Desktop shell → dist/deno */
export const denoBundle = {
  ...common,
  entryPoints: { main: "src/shells/deno/main.ts" },
  outdir: "dist/deno",
  platform: "node",
  format: "esm",
  target: "esnext",
  // Bundled CommonJS packages (yaml) require Node built-ins at run time.
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
};

/** VS Code extension → dist/vscode (build-vscode.mjs adds its manifest); VS Code provides the vscode module. */
export const vscodeBundle = {
  ...common,
  entryPoints: { extension: "src/shells/vscode/extension.ts" },
  outdir: "dist/vscode",
  outExtension: { ".js": ".cjs" },
  platform: "node",
  format: "cjs",
  target: "node22",
  external: [...common.external, "vscode"],
};

/**
 * The VS Code extension's webviews (preview and board) → dist/vscode/webview: ES modules for the
 * browser, with Mermaid, KaTeX and rockuml split off and loaded on first use.
 */
export const vscodeWebviewBundle = {
  ...common,
  entryPoints: {
    preview: "src/shells/vscode/webview/preview.ts",
    board: "src/shells/vscode/webview/board.ts",
    styles: "src/shells/vscode/webview/styles.css",
  },
  outdir: "dist/vscode/webview",
  platform: "browser",
  format: "esm",
  target: "es2022",
  splitting: true,
  minify: true,
  external: [],
  loader: { ".woff2": "file", ".woff": "file" },
};
