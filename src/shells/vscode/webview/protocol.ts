/**
 * Messages between the extension and its webviews (previews and the board).
 * Webviews render and report what the user does; every change happens in
 * the extension, through the managers, which check it.
 */
import type { ContentArea, FieldDefinition, FieldValue, Task, TaskType } from "../../../contracts/model";
import type { FollowedLink as RenderedLink, RenderContext } from "../../webview/markdown-renderer";

/** A link a webview's user followed, resolved against the document it is in; mentions stay in the webview. */
export type FollowedLink = Exclude<RenderedLink, { kind: "person" }>;

/** What rendered pages and tasks need: reference targets, people, the plan, and the settings tasks are shown with. */
export interface MarkdownContext extends RenderContext {
  /** The snapshot's version: the same version shows the same. */
  readonly version: string;
  /** Whether the project uses planning: blocked marks, plan macros. */
  readonly planning?: boolean;
  readonly hiddenColumns: readonly string[];
  readonly types: readonly TaskType[];
  readonly fields: readonly FieldDefinition[];
  /** The name the user's comments are signed with: their own comments can be edited. */
  readonly author: string | null;
}

export type PreviewDocument =
  /** `hash` is the version of the file shown; none while the editor has unsaved changes. */
  | { readonly kind: "page"; readonly path: string; readonly title: string; readonly source: string; readonly hash?: string }
  | { readonly kind: "task"; readonly task: Task };

/** Extension → webview. */
export type ToWebview =
  | { readonly type: "preview"; readonly document: PreviewDocument; readonly context: MarkdownContext }
  | { readonly type: "board"; readonly tasks: readonly Task[]; readonly context: MarkdownContext }
  /** Follows the editor: scrolls to a share of the page's length. */
  | { readonly type: "scroll"; readonly ratio: number }
  | { readonly type: "reply"; readonly id: number; readonly value?: string; readonly error?: string };

/** Task properties the extension asks for with a quick pick or an input box. */
export type PickedProperty = "title" | "status" | "type" | "priority" | "assignee" | "epic" | "labels";

/** Webview → extension. */
export type FromWebview =
  | { readonly type: "ready" }
  | { readonly type: "follow"; readonly link: FollowedLink }
  | { readonly type: "preview"; readonly area: ContentArea; readonly path: string }
  | { readonly type: "edit"; readonly area: ContentArea; readonly path: string }
  /** `hash` is the version the checkbox was shown in, when known: the toggle is refused once the file changed. */
  | { readonly type: "toggle"; readonly area: ContentArea; readonly path: string; readonly offset: number; readonly hash?: string }
  /** Moves tasks to a state, and into an epic when dropped into a swimlane. */
  | { readonly type: "move"; readonly paths: readonly string[]; readonly status: string; readonly epic?: string }
  | { readonly type: "pick"; readonly path: string; readonly property: PickedProperty }
  | { readonly type: "field"; readonly path: string; readonly name: string; readonly value: FieldValue }
  | { readonly type: "comment"; readonly path: string; readonly text: string }
  /** `index` counts the comments of the version `hash`. */
  | { readonly type: "editComment"; readonly path: string; readonly hash: string; readonly index: number; readonly text: string }
  | { readonly type: "deleteComment"; readonly path: string; readonly hash: string; readonly index: number }
  | { readonly type: "delete"; readonly path: string }
  | { readonly type: "newTask"; readonly status: string; readonly epic: string }
  /**
   * Requests answered by a `reply` with the same ID: an image as a data URL, a
   * repository file's text (as committed in `revision`, for `fileAt`), a
   * task's activity as JSON, the plan's history as JSON (with the tasks at
   * `baseline`, for `[BASELINE]`).
   */
  | { readonly type: "image"; readonly id: number; readonly path: string }
  | { readonly type: "file"; readonly id: number; readonly path: string }
  | { readonly type: "fileAt"; readonly id: number; readonly path: string; readonly revision: string }
  | { readonly type: "activity"; readonly id: number; readonly path: string }
  | { readonly type: "planHistory"; readonly id: number; readonly baseline: string | null };
