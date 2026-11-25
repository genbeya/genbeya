/**
 * The kit: Genbeya's Markdown renderer and editor for any host that shows a
 * web view and talks to it through messages (protocol.ts). It renders pages,
 * tasks and other Markdown as the app does, and edits text; the host reads
 * and writes the repository and draws everything else natively.
 */
import { referenceCandidates } from "../../client/app/markdown/references";
import type { Task } from "../../contracts/model";
import { markdownOptions, MarkdownRenderer, type RenderContext, type RendererHost } from "../webview/markdown-renderer";
import { KitBridge } from "./bridge";
import type { KitEditor } from "./editor";
import { CONTEXT_PARTS, KIT_PROTOCOL, type ContextParts, type KitDocument, type ToKit, type Versioned } from "./protocol";

/** Set by the build: the Genbeya release the kit comes from. */
declare const GENBEYA_VERSION: string;

type Parts = { -readonly [K in keyof ContextParts]?: Versioned<ContextParts[K]> };

const root = document.getElementById("root")!;
const parts: Parts = {};
let mode: "light" | "dark" | null = null;
let shown: KitDocument | null = null;
let editor: KitEditor | null = null;
let opening = 0;

const context = (): RenderContext => {
  const settings = parts.settings?.value;
  return {
    wikiRoot: settings?.wikiRoot ?? "docs",
    wiki: parts.wiki?.value ?? [],
    tasks: parts.tasks?.value ?? [],
    plan: parts.plan?.value ?? [],
    statuses: settings?.statuses ?? [],
    ...(settings?.calendar ? { calendar: settings.calendar } : {}),
    files: parts.files?.value ?? [],
    people: parts.people?.value ?? [],
  };
};

const light = () => (mode ? mode === "light" : window.matchMedia("(prefers-color-scheme: light)").matches);

const bridge = new KitBridge(receive);

const host: RendererHost = {
  request: (request) => bridge.request(request),
  follow: (link) => bridge.post({ type: "follow", link }),
  toggle: ({ area, path, hash }, offset) => {
    if (hash) bridge.post({ type: "toggle", area, path, hash, offset });
  },
  light,
  rockumlWasm: "rockuml.wasm",
};

const renderer = new MarkdownRenderer(host);
renderer.listen(root);

function receive(message: Exclude<ToKit, { type: "reply" }>) {
  switch (message.type) {
    case "context":
      return applyContext(message.parts);
    case "theme":
      return applyTheme(message.mode, message.tokens);
    case "preview":
      shown = message.document;
      return show();
    case "edit":
      return void edit(message);
    case "editorCommand":
      return editor?.run(message.command, message.text);
  }
}

/** Takes the parts whose version changed; what is shown follows them. */
function applyContext(sent: Parts) {
  let changed = false;
  for (const name of CONTEXT_PARTS) {
    const part = sent[name];
    if (!part || parts[name]?.version === part.version) continue;
    (parts as Record<string, unknown>)[name] = part;
    changed = true;
  }
  if (changed && !editor) show();
}

function applyTheme(next: "light" | "dark", tokens: Readonly<Record<string, string>>) {
  mode = next;
  const element = document.documentElement;
  element.dataset["theme"] = next;
  for (const [name, value] of Object.entries(tokens)) element.style.setProperty(`--${name}`, value);
  // Diagrams take the theme's colours when they are drawn.
  if (!editor) show();
}

function show() {
  editor?.destroy();
  editor = null;
  opening++;
  if (!shown) return root.replaceChildren();
  const doc = shown;
  const page = element("article", "kit-document");
  root.replaceChildren(page);
  if (doc.kind === "task") return showTask(page, doc.task);
  const area = doc.kind === "page" ? "wiki" : doc.area;
  renderer.render(page, doc.source, { path: doc.path, area, checkboxes: true, hash: doc.hash }, context());
}

/** A task's description, whose checkboxes tick, and its comments; the host shows its title and properties. */
function showTask(page: HTMLElement, task: Task) {
  const description = element("div", "kit-description");
  page.append(description);
  if (task.body.trim())
    renderer.render(description, task.body, { path: task.path, area: "tasks", checkboxes: true, hash: task.hash }, context());
  for (const comment of task.comments) {
    const section = element("section", "kit-comment");
    const heading = element("p", "kit-comment-head");
    heading.append(element("strong", "", comment.author), document.createTextNode(` · ${comment.date.replace("T", " ")}`));
    const body = element("div", "kit-comment-body");
    section.append(heading, body);
    page.append(section);
    renderer.render(body, comment.body, { path: task.path, area: "tasks", checkboxes: false }, context());
  }
}

async function edit(file: Extract<ToKit, { type: "edit" }>) {
  const ticket = ++opening;
  const { KitEditor } = await import("./editor");
  if (ticket !== opening) return;
  editor?.destroy();
  const parent = element("div", "kit-editor");
  root.replaceChildren(parent);
  editor = new KitEditor(
    parent,
    file,
    {
      references: () => referenceCandidates(markdownOptions(context(), file.path).references!),
      people: () => context().people,
    },
    bridge,
  );
  editor.focus();
}

function element(tag: string, className: string, text = ""): HTMLElement {
  const created = document.createElement(tag);
  if (className) created.className = className;
  if (text) created.textContent = text;
  return created;
}

/** The host sizes its web view to the rendered content. */
let reported = -1;
new ResizeObserver(() => {
  const height = Math.ceil(document.documentElement.scrollHeight);
  if (height === reported) return;
  reported = height;
  bridge.post({ type: "height", height });
}).observe(document.body);

bridge.post({ type: "ready", protocol: KIT_PROTOCOL, genbeya: GENBEYA_VERSION });
