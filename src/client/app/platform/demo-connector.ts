/**
 * The web demo: the managers run here in the page, on in-memory
 * repositories (`src/managers/demo`), as Tauri's run in its webview.
 * Requests still cross a cloning transport, so the client sees the same
 * isolated values as with every shell. Nothing is stored anywhere: layout
 * choices live in memory too, and loading the page again starts over.
 */
import { connectManagers, dispatch } from "../../../contracts/rpc";
import { createDemoBackend } from "../../../managers/demo/demo-backend";
import { DEMO_FOLDER } from "../../../managers/demo/demo-workspace-manager";
import type { Platform } from "./platform";

export const DOWNLOAD_URL = "https://genbeya.fyi/download";

/** What the demo needs of the page it runs in. */
export type DemoPage = Pick<Window, "location" | "open" | "document" | "addEventListener" | "removeEventListener">;

/** Layout choices for as long as the page is open. */
function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, String(value)),
  };
}

export function connectDemo(page: DemoPage = window): Platform {
  const backend = createDemoBackend();
  let leaving = false;
  return {
    managers: connectManagers(async (request) => structuredClone(await dispatch(backend, structuredClone(request)))),
    storage: memoryStorage(),
    demo: {
      downloadUrl: DOWNLOAD_URL,
      reset() {
        leaving = true;
        // Loading the page again starts over, at the start rather than the view the address names.
        page.location.replace(page.location.pathname + page.location.search);
      },
    },
    shell: {
      runtime: "demo",
      // The demo machine's only folder: opening it explains that the visitor's folders are out of reach, and samples go there.
      pickFolder: async () => ({ kind: "local", path: DEMO_FOLDER }),
      async openExternal(url) {
        if (!/^(https?:|mailto:)/i.test(url)) throw new Error("Only web and mail links open externally.");
        page.open(url, "_blank", "noopener,noreferrer");
      },
      setTitle: (title) => void (page.document.title = title),
      // The page's own colours follow the theme; a browser has no native parts to tell.
      setTheme: () => undefined,
      launchArgs: async () => [],
      onSecondLaunch: () => () => undefined,
      guardClose(hasUnsavedChanges) {
        // The browser asks whether to leave when the page vetoes unloading.
        const veto = (event: Event) => {
          if (!leaving && hasUnsavedChanges()) event.preventDefault();
        };
        page.addEventListener("beforeunload", veto);
        return () => page.removeEventListener("beforeunload", veto);
      },
    },
  };
}
