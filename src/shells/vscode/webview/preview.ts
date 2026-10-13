/** The preview webview: one page or task, rendered as the app renders it. */
import "./theme";
import { Bridge } from "./bridge";
import { MarkdownRenderer } from "./markdown";
import { renderTask } from "./task";

const root = document.getElementById("root")!;
const bridge = new Bridge((message) => {
  if (message.type !== "preview") return;
  const { document: shown, context } = message;
  if (shown.kind === "task") return renderTask(root, shown.task, context, markdown);
  const page = document.createElement("div");
  root.replaceChildren(page);
  markdown.render(page, shown.source, { path: shown.path, area: "wiki", checkboxes: true }, context);
});
const markdown = new MarkdownRenderer(bridge);
markdown.listen(root);
