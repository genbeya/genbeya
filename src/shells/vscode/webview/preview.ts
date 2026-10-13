/** The preview webview: one page or task, rendered as the app renders it; a task's properties and comments can be changed. */
import "./theme";
import type { ContentArea } from "../../../contracts/model";
import { Bridge } from "./bridge";
import { MarkdownRenderer } from "./markdown";
import { TaskView } from "./task";

const root = document.getElementById("root")!;
const bridge = new Bridge((message) => {
  if (message.type === "scroll") {
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    return window.scrollTo({ top: message.ratio * scrollable });
  }
  if (message.type !== "preview") return;
  const { document: shown, context } = message;
  // Kept for VS Code to reopen this preview after a restart.
  const state: { area: ContentArea; path: string } =
    shown.kind === "task" ? { area: "tasks", path: shown.task.path } : { area: "wiki", path: shown.path };
  bridge.state = state;
  if (shown.kind === "task") return tasks.render(root, shown.task, context, context.version, { toolbar: true });
  const page = document.createElement("div");
  root.replaceChildren(page);
  markdown.render(page, shown.source, { path: shown.path, area: "wiki", checkboxes: true }, context);
});
const markdown = new MarkdownRenderer(bridge);
const tasks = new TaskView(bridge, markdown);
markdown.listen(root);
