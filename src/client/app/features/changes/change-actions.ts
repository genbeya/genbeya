/**
 * Staging, unstaging and discarding changes — whole files and folders, or
 * hunks and lines of a diff — and keeping files out of Git, with the
 * confirmations they need. Staged changes are compared with what the
 * session compares them with: HEAD, or its parent while amending.
 */
import { Injectable, inject } from "@angular/core";
import type { Change, Diff, IgnoreKind, LinePatch, LineSelection } from "../../../../contracts/model";
import { Dialogs } from "../../core/dialogs";
import { Session } from "../../core/session";
import { WorkspaceApi } from "../../core/workspace-api";
import type { IgnoreChoice, IgnoreRequest } from "./ignore-dialog";

/** What can be done with lines of a diff. */
export type LineAction = "stage" | "unstage" | "discard";

@Injectable({ providedIn: "root" })
export class ChangeActions {
  private readonly session = inject(Session);
  private readonly api = inject(WorkspaceApi);
  private readonly dialogs = inject(Dialogs);

  stage(paths: readonly string[]): Promise<boolean> {
    return this.session.succeeded(() => this.api.versionControl.stage(paths));
  }

  /** While amending, unstaging leaves the changes out of the amended commit. */
  unstage(paths: readonly string[]): Promise<boolean> {
    const base = this.session.changeBase();
    return this.session.succeeded(() => this.api.versionControl.unstage(paths, base));
  }

  /** Asks, then discards; `subject` names a folder, else the paths are named. */
  async discard(paths: readonly string[], subject?: string): Promise<boolean> {
    const single = paths.length === 1 && !subject;
    const confirmed = await this.dialogs.confirm({
      title: single ? "Discard changes" : `Discard ${paths.length} changes`,
      message: single
        ? `Discard your changes to ${paths[0]}? This cannot be undone.`
        : subject
          ? `Discard your changes in ${subject}? Untracked files are deleted. This cannot be undone.`
          : "Discard all unstaged changes? Untracked files are deleted. This cannot be undone.",
      confirm: "Discard",
      danger: true,
    });
    return confirmed && this.session.succeeded(() => this.api.versionControl.discard(paths));
  }

  /**
   * Stages, unstages or discards `lines` of the diff of `change` the user
   * looked at; discarding asks first. Resolves to false when cancelled.
   */
  async lines(action: LineAction, change: Change, lines: LineSelection, diff: Diff, hunk: boolean): Promise<boolean> {
    if (action === "discard") {
      const confirmed = await this.dialogs.confirm({
        title: hunk ? "Discard change" : "Discard lines",
        message: `Discard ${hunk ? "this change" : "the selected lines"} of ${change.path}? This cannot be undone.`,
        confirm: "Discard",
        danger: true,
      });
      if (!confirmed) return false;
    }
    const versionControl = this.api.versionControl;
    const patch: LinePatch = { path: change.path, version: diff.version, lines };
    if (action === "stage") return this.session.succeeded(() => versionControl.stageLines(patch));
    if (action === "discard") return this.session.succeeded(() => versionControl.discardLines(patch));
    const base = this.session.changeBase();
    return this.session.succeeded(() => versionControl.unstageLines(change.oldPath ? { ...patch, oldPath: change.oldPath } : patch, base));
  }

  /**
   * Asks which .gitignore gets the rule for `path` (a file, or a folder for
   * "folder"), then adds it; files Git tracks can stop being tracked too.
   */
  async ignore(path: string, kind: IgnoreKind, tracked: boolean): Promise<boolean> {
    const { IgnoreDialog } = await import("./ignore-dialog");
    const choice = await this.dialogs.open<IgnoreChoice, IgnoreRequest>(IgnoreDialog, { path, kind, tracked });
    if (!choice) return false;
    return this.session.succeeded(async () => {
      await this.api.versionControl.ignore(path, kind, choice.location);
      if (choice.untrack) await this.api.versionControl.untrack([path]);
    }, "Added to .gitignore");
  }

  /** Asks, then removes files or a folder from the index, keeping them on disk. */
  async untrack(path: string, folder: boolean): Promise<boolean> {
    const confirmed = await this.dialogs.confirm({
      title: "Stop tracking",
      message: `Stop tracking ${folder ? `the files in ${path}` : path}? ${folder ? "They stay" : "It stays"} on disk, but the next commit deletes ${folder ? "them" : "it"} from the repository. Add ${folder ? "the folder" : "it"} to .gitignore to keep Git from offering ${folder ? "them" : "it"} again.`,
      confirm: "Stop tracking",
      danger: true,
    });
    return confirmed && this.session.succeeded(() => this.api.versionControl.untrack([path]));
  }
}
