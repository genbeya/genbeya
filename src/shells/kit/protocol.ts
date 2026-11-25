/**
 * Messages between the kit and its host: JSON strings through two globals,
 * `window.genbeyaKitHost.post` (set by the host) and `window.genbeyaKit.receive`
 * (set by the kit). The kit renders and edits; the host reads and writes the
 * repository, so everything the kit sends is a request the host checks.
 * Documented in the wiki's Architecture/Kit page.
 *
 * `KIT_PROTOCOL` is a whole number: adding a message or an optional field
 * keeps it, removing or changing one raises it.
 */
import { CONTENT_AREAS, type ContentArea, type Person, type Task, type WikiNode } from "../../contracts/model";
import type { PlanCalendar, PlanTask } from "../../utilities/planning";
import type { FollowedLink } from "../webview/markdown-renderer";

export const KIT_PROTOCOL = 1;

/** A part of the context with the version it was sent at; a part is only sent again once its version changed. */
export interface Versioned<T> {
  readonly version: string;
  readonly value: T;
}

export interface KitSettings {
  readonly wikiRoot: string;
  /** The workflow, in board order; the last state is done. */
  readonly statuses: readonly string[];
  readonly calendar?: PlanCalendar;
}

/** What rendered Markdown refers to, part by part, so a large file list goes once, not with every edit. */
export interface ContextParts {
  readonly wiki: readonly WikiNode[];
  readonly tasks: readonly Pick<Task, "id" | "path" | "title" | "status">[];
  readonly plan: readonly PlanTask[];
  readonly files: readonly string[];
  readonly people: readonly Person[];
  readonly settings: KitSettings;
  /** The name the user's text is signed with. */
  readonly author: string | null;
}

export type ContextPart = keyof ContextParts;
export const CONTEXT_PARTS: readonly ContextPart[] = ["wiki", "tasks", "plan", "files", "people", "settings", "author"];

export type KitDocument =
  | { readonly kind: "page"; readonly path: string; readonly title: string; readonly source: string; readonly hash: string }
  /** The kit shows the task's description and comments; the host its title and properties. */
  | { readonly kind: "task"; readonly task: Task }
  /** Any other Markdown: a pull request file, a comment. */
  | { readonly kind: "markdown"; readonly area: ContentArea; readonly path: string; readonly source: string; readonly hash: string };

export const EDITOR_COMMANDS = ["bold", "italic", "heading", "list", "checkbox", "link", "insert", "undo", "redo", "find", "save"] as const;
export type EditorCommand = (typeof EDITOR_COMMANDS)[number];

/** Host → kit. */
export type ToKit =
  | { readonly type: "context"; readonly parts: { readonly [K in ContextPart]?: Versioned<ContextParts[K]> } }
  /** The app's colour and type tokens (CSS variables without their `--`), for a light or dark page. */
  | { readonly type: "theme"; readonly mode: "light" | "dark"; readonly tokens: Readonly<Record<string, string>> }
  | { readonly type: "preview"; readonly document: KitDocument }
  /** Opens the editor; the language follows from the path. */
  | {
      readonly type: "edit";
      readonly area: ContentArea;
      readonly path: string;
      readonly text: string;
      readonly hash: string;
      readonly readOnly: boolean;
    }
  /** The host's toolbar drives the editor; `insert` inserts `text`. */
  | { readonly type: "editorCommand"; readonly command: EditorCommand; readonly text?: string }
  | { readonly type: "reply"; readonly id: number; readonly value?: string; readonly error?: string };

/** Kit → host. */
export type FromKit =
  | { readonly type: "ready"; readonly protocol: number; readonly genbeya: string }
  /** A followed link; a task reference arrives as its task's file. Open web links only for http, https and mailto. */
  | { readonly type: "follow"; readonly link: FollowedLink }
  /** Check that the file still has `hash` and a checkbox at `offset` of the text shown, then write. */
  | { readonly type: "toggle"; readonly area: ContentArea; readonly path: string; readonly hash: string; readonly offset: number }
  /** Requests: answer with a `reply` of the same `id`, after checking the path with Genbeya's rules. */
  | { readonly type: "image"; readonly id: number; readonly path: string }
  | { readonly type: "file"; readonly id: number; readonly path: string }
  | { readonly type: "fileAt"; readonly id: number; readonly path: string; readonly revision: string }
  /** As `content.planHistory` answers, as JSON: for `[BURNDOWN]`, and for `[BASELINE]` with the tasks at `baseline`. */
  | { readonly type: "planHistory"; readonly id: number; readonly baseline: string | null }
  /** The rendered height in CSS pixels, to size the web view. */
  | { readonly type: "height"; readonly height: number }
  /** Unsaved text, to keep outside the repository. */
  | { readonly type: "draft"; readonly path: string; readonly hash: string; readonly text: string }
  /** Write as `content.write` does: refused once the file changed since `hash`. Send `edit` again with the new hash. */
  | { readonly type: "save"; readonly path: string; readonly hash: string; readonly text: string }
  | {
      readonly type: "editorState";
      readonly path: string;
      readonly dirty: boolean;
      readonly selection: { readonly from: number; readonly to: number };
      readonly completing: boolean;
    }
  /** What the kit refused, such as an invalid message. */
  | { readonly type: "error"; readonly message: string };

export class ProtocolError extends Error {}

type Fields = Readonly<Record<string, unknown>>;

const LINK_KINDS = ["external", "missing", "person", "file"];
/** A token is a CSS variable name and a value that can't end the declaration or open markup. */
const TOKEN_NAME = /^[a-z][a-z0-9-]{0,62}$/;
const TOKEN_VALUE = /^[^;{}<>\\]{0,200}$/;

function fail(message: string): never {
  throw new ProtocolError(message);
}

function record(value: unknown, what: string): Fields {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${what} is not an object.`);
  return value as Fields;
}

function text(fields: Fields, key: string, what: string): string {
  const value = fields[key];
  if (typeof value !== "string") fail(`${what}.${key} is not a string.`);
  return value;
}

function whole(fields: Fields, key: string, what: string): number {
  const value = fields[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) fail(`${what}.${key} is not a whole number.`);
  return value;
}

function area(fields: Fields, what: string): ContentArea {
  const value = text(fields, "area", what);
  if (!(CONTENT_AREAS as readonly string[]).includes(value)) fail(`${what}.area is not a content area.`);
  return value as ContentArea;
}

function list(value: unknown, what: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(`${what} is not a list.`);
  return value;
}

function documentOf(value: unknown): KitDocument {
  const document = record(value, "preview.document");
  const what = "preview.document";
  switch (document["kind"]) {
    case "page":
      for (const key of ["path", "title", "source", "hash"]) text(document, key, what);
      return document as unknown as KitDocument;
    case "markdown":
      area(document, what);
      for (const key of ["path", "source", "hash"]) text(document, key, what);
      return document as unknown as KitDocument;
    case "task": {
      const task = record(document["task"], `${what}.task`);
      for (const key of ["id", "path", "title", "body", "hash"]) text(task, key, `${what}.task`);
      list(task["comments"], `${what}.task.comments`);
      return document as unknown as KitDocument;
    }
    default:
      return fail(`${what}.kind is not page, task or markdown.`);
  }
}

function contextOf(fields: Fields): ToKit {
  const parts = record(fields["parts"], "context.parts");
  for (const [name, part] of Object.entries(parts)) {
    if (!CONTEXT_PARTS.includes(name as ContextPart)) fail(`context.parts.${name} is not a part of the context.`);
    const versioned = record(part, `context.parts.${name}`);
    text(versioned, "version", `context.parts.${name}`);
    const value = versioned["value"];
    if (name === "settings") {
      const settings = record(value, "context.parts.settings.value");
      text(settings, "wikiRoot", "context.parts.settings.value");
      list(settings["statuses"], "context.parts.settings.value.statuses");
    } else if (name === "author") {
      if (value !== null && typeof value !== "string") fail("context.parts.author.value is not a name or null.");
    } else list(value, `context.parts.${name}.value`);
  }
  return { type: "context", parts } as ToKit;
}

/** A host's message, checked: what the kit acts on. Throws a {@link ProtocolError} for anything else. */
export function parseToKit(json: string): ToKit {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    fail("The message is not JSON.");
  }
  const message = record(parsed, "The message");
  switch (message["type"]) {
    case "context":
      return contextOf(message);
    case "theme": {
      if (message["mode"] !== "light" && message["mode"] !== "dark") fail("theme.mode is not light or dark.");
      const tokens = record(message["tokens"], "theme.tokens");
      for (const [name, value] of Object.entries(tokens))
        if (!TOKEN_NAME.test(name) || typeof value !== "string" || !TOKEN_VALUE.test(value)) fail(`theme.tokens.${name} is not a token.`);
      return message as unknown as ToKit;
    }
    case "preview":
      documentOf(message["document"]);
      return message as unknown as ToKit;
    case "edit":
      area(message, "edit");
      for (const key of ["path", "text", "hash"]) text(message, key, "edit");
      if (typeof message["readOnly"] !== "boolean") fail("edit.readOnly is not true or false.");
      return message as unknown as ToKit;
    case "editorCommand":
      if (!EDITOR_COMMANDS.includes(message["command"] as EditorCommand)) fail("editorCommand.command is not a command.");
      if (message["command"] === "insert") text(message, "text", "editorCommand");
      return message as unknown as ToKit;
    case "reply":
      whole(message, "id", "reply");
      if (message["value"] !== undefined) text(message, "value", "reply");
      if (message["error"] !== undefined) text(message, "error", "reply");
      return message as unknown as ToKit;
    default:
      return fail(`${String(message["type"])} is not a message the kit takes.`);
  }
}

function linkOf(value: unknown): FollowedLink {
  const link = record(value, "follow.link");
  const kind = link["kind"];
  if (!LINK_KINDS.includes(kind as string)) fail("follow.link.kind is not a kind of link.");
  if (kind === "external") text(link, "url", "follow.link");
  if (kind === "missing") text(link, "title", "follow.link");
  if (kind === "person") text(link, "handle", "follow.link");
  if (kind === "file") {
    text(link, "path", "follow.link");
    if (link["anchor"] !== undefined) text(link, "anchor", "follow.link");
  }
  return link as unknown as FollowedLink;
}

/**
 * A message from the kit, checked: one of the protocol's, with every field it
 * needs. Hosts written in JavaScript can check with it; the tests check
 * everything the kit sends with it.
 */
export function checkFromKit(value: unknown): FromKit {
  const message = record(value, "The message");
  const what = String(message["type"]);
  switch (message["type"]) {
    case "ready":
      whole(message, "protocol", what);
      text(message, "genbeya", what);
      break;
    case "follow":
      linkOf(message["link"]);
      break;
    case "toggle":
      area(message, what);
      text(message, "path", what);
      text(message, "hash", what);
      whole(message, "offset", what);
      break;
    case "image":
    case "file":
      whole(message, "id", what);
      text(message, "path", what);
      break;
    case "fileAt":
      whole(message, "id", what);
      text(message, "path", what);
      text(message, "revision", what);
      break;
    case "planHistory":
      whole(message, "id", what);
      if (message["baseline"] !== null) text(message, "baseline", what);
      break;
    case "height":
      whole(message, "height", what);
      break;
    case "draft":
    case "save":
      for (const key of ["path", "hash", "text"]) text(message, key, what);
      break;
    case "editorState": {
      text(message, "path", what);
      if (typeof message["dirty"] !== "boolean" || typeof message["completing"] !== "boolean")
        fail(`${what} has no dirty or completing flag.`);
      const selection = record(message["selection"], `${what}.selection`);
      whole(selection, "from", `${what}.selection`);
      whole(selection, "to", `${what}.selection`);
      break;
    }
    case "error":
      text(message, "message", what);
      break;
    default:
      fail(`${what} is not a message of the kit.`);
  }
  return message as unknown as FromKit;
}
