/**
 * Messages between the extension and its webviews (the preview and the
 * board). Webviews only render and report clicks; everything they show
 * comes from the extension, and everything they ask for is checked there.
 */
import type { ContentArea, Person, Task, WikiNode } from "../../../contracts/model";

/** What rendered Markdown needs to resolve references and mentions. */
export interface MarkdownContext {
  readonly wikiRoot: string;
  readonly wiki: readonly WikiNode[];
  readonly tasks: readonly Pick<Task, "id" | "path" | "title" | "status">[];
  readonly statuses: readonly string[];
  readonly files: readonly string[];
  readonly people: readonly Person[];
}

export type PreviewDocument =
  | { readonly kind: "page"; readonly path: string; readonly title: string; readonly source: string }
  | { readonly kind: "task"; readonly task: Task };

export interface BoardColumn {
  readonly status: string;
  readonly tasks: readonly Task[];
}

/** Extension → webview. */
export type ToWebview =
  | { readonly type: "preview"; readonly document: PreviewDocument; readonly context: MarkdownContext }
  | { readonly type: "board"; readonly columns: readonly BoardColumn[]; readonly context: MarkdownContext }
  | { readonly type: "reply"; readonly id: number; readonly value?: string; readonly error?: string };

/** A link a webview's user followed, resolved against the document it is in. */
export type FollowedLink =
  | { readonly kind: "external"; readonly url: string }
  | { readonly kind: "missing"; readonly title: string }
  | { readonly kind: "file"; readonly path: string; readonly anchor: string | undefined };

/** Webview → extension. */
export type FromWebview =
  | { readonly type: "ready" }
  | { readonly type: "follow"; readonly link: FollowedLink }
  | { readonly type: "preview"; readonly area: ContentArea; readonly path: string }
  | { readonly type: "edit"; readonly area: ContentArea; readonly path: string }
  | { readonly type: "move"; readonly paths: readonly string[]; readonly status: string }
  | { readonly type: "toggle"; readonly area: ContentArea; readonly path: string; readonly offset: number }
  /** Requests answered by a `reply` with the same ID: an image as a data URL, or a repository file's text. */
  | { readonly type: "image"; readonly id: number; readonly path: string }
  | { readonly type: "file"; readonly id: number; readonly path: string };
