import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from "@angular/core";
import { Router } from "@angular/router";
import { pinnedText, shortRevision } from "../../../../utilities/references";
import { Session } from "../../core/session";
import { WorkspaceApi } from "../../core/workspace-api";
import { CodeEditor, type LineRange } from "../../editor/code-editor";
import { EmptyState } from "../../ui/empty-state";
import { Icon } from "../../ui/icon";

/** A file as committed in a revision (`?file=…&rev=…`), from a pinned reference: read-only, with the way to the file as it is now. */
@Component({
  selector: "gd-pinned-file",
  imports: [CodeEditor, EmptyState, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "view" },
  template: `
    <header class="view-header">
      <div class="view-title code-path" [attr.aria-label]="path() + ' as of ' + revision()">
        @for (segment of folders(); track $index) {
          <span class="row crumb-row"
            ><span class="crumb">{{ segment }}</span
            ><svg gd-icon name="chevron-right" [size]="12" class="crumb-sep"></svg
          ></span>
        }
        <span>{{ name() }}</span>
      </div>
      <span class="revision" [title]="revision()"><svg gd-icon name="git-commit-horizontal" [size]="13"></svg>{{ short() }}</span>
      <span class="file-facts">Read-only</span>
      <span class="grow"></span>
      <button type="button" class="btn btn-m btn-default" (click)="openCurrent()"><span>Open current version</span></button>
    </header>
    @if (error(); as message) {
      <gd-empty-state title="Can't show this version">
        <svg icon gd-icon name="file" [size]="20"></svg>
        <p class="selectable">{{ message }}</p>
      </gd-empty-state>
    } @else if (content() !== null) {
      <gd-code-editor
        [label]="'Contents of ' + path() + ' as of ' + short()"
        [path]="path()"
        [value]="content()!"
        [readOnly]="true"
        [reveal]="lines()"
        [minimap]="session.preferences().minimap"
      />
    } @else {
      <div class="editor-loading"><span class="spinner" aria-label="Loading"></span></div>
    }
  `,
  styles: `
    .code-path {
      gap: 4px;
      font-family: var(--font-mono);
      font-size: 12.5px;
      font-weight: 500;
    }
    .code-path .crumb {
      color: var(--text-3);
    }
    .crumb-row {
      gap: 4px;
    }
    .revision {
      display: inline-flex;
      flex: none;
      align-items: center;
      gap: 4px;
      padding: 0 6px;
      border-radius: var(--radius-s);
      background: var(--bg-raised);
      color: var(--text-2);
      font: 500 12px var(--font-mono);
    }
    .file-facts {
      flex: none;
      color: var(--text-3);
      font-size: 12px;
    }
  `,
})
export class PinnedFile {
  readonly path = input.required<string>();
  readonly revision = input.required<string>();
  /** Lines to show, from the reference. */
  readonly lines = input<LineRange | null>(null);

  protected readonly session = inject(Session);
  private readonly api = inject(WorkspaceApi);
  private readonly router = inject(Router);
  protected readonly short = computed(() => shortRevision(this.revision()));
  protected readonly folders = computed(() => this.path().split("/").slice(0, -1));
  protected readonly name = computed(() => this.path().split("/").at(-1)!);
  /** Empty text is a file too; null while it loads. */
  protected readonly content = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  constructor() {
    effect((onCleanup) => {
      const [path, revision] = [this.path(), this.revision()];
      let shown = true;
      onCleanup(() => (shown = false));
      this.content.set(null);
      this.error.set(null);
      this.api.versionControl.fileAt(revision, path).then(
        (file) => {
          if (!shown) return;
          try {
            this.content.set(pinnedText(file, path, revision));
          } catch (error) {
            this.error.set((error as Error).message);
          }
        },
        (error: unknown) => shown && this.error.set(error instanceof Error ? error.message : String(error)),
      );
    });
  }

  protected openCurrent() {
    const range = this.lines();
    void this.router.navigate(["/code"], { queryParams: { file: this.path(), lines: range ? `${range.from}-${range.to}` : null } });
  }
}
