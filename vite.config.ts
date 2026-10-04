import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** The dev server needs HMR and the browser bridge; production allows neither. */
function contentSecurityPolicy(): Plugin {
  let dev = false;
  return {
    name: "gitdesk-csp",
    configResolved: (config) => {
      dev = config.command === "serve";
    },
    transformIndexHtml: (html) =>
      html.replace("%CONNECT_SRC%", dev ? "'self' ws://127.0.0.1:5173 http://127.0.0.1:5174" : "'self'"),
  };
}

export default defineConfig({
  plugins: [react(), contentSecurityPolicy()],
  base: "./",
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  build: { outDir: "dist", chunkSizeWarningLimit: 8000 },
});
