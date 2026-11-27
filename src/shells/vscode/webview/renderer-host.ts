/** The shared Markdown renderer's host in a VS Code webview: requests and reports go through the bridge to the extension. */
import type { RendererHost } from "../../webview/markdown-renderer";
import type { Bridge } from "./bridge";

const light = () => document.body.classList.contains("vscode-light") || document.body.classList.contains("vscode-high-contrast-light");

export function rendererHost(bridge: Bridge): RendererHost {
  return {
    request: (request) => bridge.request(request),
    // VS Code has nothing to show for a person; the rendered mention says who it is.
    follow: (link) => {
      if (link.kind !== "person") bridge.post({ type: "follow", link });
    },
    toggle: ({ area, path, hash }, offset) => bridge.post({ type: "toggle", area, path, offset, ...(hash ? { hash } : {}) }),
    light,
    ...(document.body.dataset["rockuml"] ? { rockumlWasm: document.body.dataset["rockuml"] } : {}),
  };
}
