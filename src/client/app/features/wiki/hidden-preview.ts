import { DIALOG_DATA, DialogRef } from "@angular/cdk/dialog";
import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import type { Scope } from "../../../../contracts/model";
import { stripFrontmatter } from "../../core/file-resource";
import { messageOf } from "../../core/notifications";
import { WorkspaceApi } from "../../core/workspace-api";
import { MarkdownView } from "../../markdown/markdown-view";
import { DialogFrame } from "../../ui/dialog-frame";
import { WikiActions } from "./wiki-actions";

export interface HiddenPreviewRequest {
  readonly title: string;
  readonly path: string;
  /** Pages and tasks are read where their area lives, files from the checkout. */
  readonly scope: Scope;
  /** What is hidden, as a sentence names it: "The wiki". */
  readonly part: string;
}

/**
 * A page, task or file of a hidden part, read-only: references into a part
 * the user turned off still show what they point at, without the view.
 */
@Component({
  selector: "gd-hidden-preview",
  imports: [DialogFrame, MarkdownView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <gd-dialog-frame [title]="request.title" [width]="720">
      <p class="dialog-hint">{{ request.part }} is turned off in Settings, so this is a read-only preview.</p>
      @if (error(); as message) {
        <p class="dialog-error" role="alert">{{ message }}</p>
      } @else if (source() !== null) {
        <div class="hidden-preview">
          <gd-markdown [source]="source()!" [path]="request.path" [links]="wiki.linkTargets()" />
        </div>
      } @else {
        <div class="editor-loading"><span class="spinner" aria-label="Loading"></span></div>
      }
      <footer>
        <button type="button" class="btn btn-default btn-m" (click)="dialog.close()"><span>Close</span></button>
      </footer>
    </gd-dialog-frame>
  `,
  styles: `
    .hidden-preview {
      max-height: 60vh;
      overflow: auto;
    }
  `,
})
export class HiddenPreview {
  protected readonly request = inject<HiddenPreviewRequest>(DIALOG_DATA);
  protected readonly dialog = inject(DialogRef);
  protected readonly wiki = inject(WikiActions);
  private readonly api = inject(WorkspaceApi);
  protected readonly source = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  constructor() {
    const { path, scope } = this.request;
    const markdown = path.toLowerCase().endsWith(".md");
    this.api.content.read(scope, path).then(
      (file) => {
        const fence = "`".repeat(Math.max(3, ...[...file.content.matchAll(/`+/g)].map((run) => run[0].length + 1)));
        this.source.set(markdown ? stripFrontmatter(file.content) : `${fence}\n${file.content}\n${fence}`);
      },
      (failure: unknown) => this.error.set(messageOf(failure)),
    );
  }
}
