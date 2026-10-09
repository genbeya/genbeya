import { CdkMenu, CdkMenuTrigger } from "@angular/cdk/menu";
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from "@angular/core";
import { Router } from "@angular/router";
import { LucideChevronRight, LucideCopy, LucideEllipsis, LucideEye, LucideFile, LucideFileDiff, LucidePencil, LucideTrash2 } from "@lucide/angular";
import { Dialogs } from "../../core/dialogs";
import { fileResource } from "../../core/file-resource";
import { hotkey, MOD_KEY } from "../../core/hotkeys";
import { Notifications } from "../../core/notifications";
import { Session } from "../../core/session";
import { trackUnsaved } from "../../core/unsaved-changes";
import { WorkspaceApi } from "../../core/workspace-api";
import { CodeEditor } from "../../editor/code-editor";
import { MarkdownView } from "../../markdown/markdown-view";
import { EmptyState } from "../../ui/empty-state";
import { MenuItem } from "../../ui/menu-item";
import { WikiActions } from "../wiki/wiki-actions";

/** One repository file in the editor; Markdown can also be previewed. */
@Component({
  selector: "gd-file-editor",
  imports: [CdkMenu, CdkMenuTrigger, CodeEditor, EmptyState, MarkdownView, MenuItem, LucideChevronRight, LucideCopy, LucideEllipsis, LucideEye, LucideFile, LucideFileDiff, LucidePencil, LucideTrash2],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "view" },
  template: `
    <header class="view-header">
      <div class="view-title code-path" [attr.aria-label]="path()">
        @for (segment of folders(); track $index) {
          <span class="row crumb-row"><span class="crumb">{{ segment }}</span><svg lucideChevronRight [size]="12" class="crumb-sep" aria-hidden="true"></svg></span>
        }
        <span>{{ name() }}</span>
      </div>
      @if (dirty()) {
        <span class="dirty-dot" title="Unsaved changes" aria-label="Unsaved changes"></span>
      }
      <span class="grow"></span>
      @if (markdown()) {
        <div class="segmented" role="radiogroup" aria-label="Mode">
          <button type="button" role="radio" [attr.aria-checked]="!preview()" [class.is-active]="!preview()" (click)="preview.set(false)"><svg lucidePencil [size]="12" aria-hidden="true"></svg> Edit</button>
          <button type="button" role="radio" [attr.aria-checked]="preview()" [class.is-active]="preview()" (click)="preview.set(true)"><svg lucideEye [size]="12" aria-hidden="true"></svg> Preview</button>
        </div>
      }
      <button type="button" class="btn btn-m" [class.btn-primary]="dirty()" [class.btn-default]="!dirty()" [disabled]="!dirty()" (click)="save()">
        <span>Save</span><kbd class="kbd">{{ mod }} S</kbd>
      </button>
      <button type="button" class="icon-btn" aria-label="File actions" title="File actions" [cdkMenuTriggerFor]="actions" #trigger="cdkMenuTriggerFor" [class.is-active]="trigger.isOpen()">
        <svg lucideEllipsis [size]="16" aria-hidden="true"></svg>
      </button>
    </header>
    <ng-template #actions>
      <div class="menu" cdkMenu>
        <button gd-menu-item (selected)="copyPath()"><svg icon lucideCopy [size]="14" aria-hidden="true"></svg>Copy path</button>
        <button gd-menu-item [disabled]="!changed()" (selected)="showChanges()"><svg icon lucideFileDiff [size]="14" aria-hidden="true"></svg>Show changes</button>
        <div class="menu-separator"></div>
        <button gd-menu-item [danger]="true" (selected)="remove()"><svg icon lucideTrash2 [size]="14" aria-hidden="true"></svg>Delete file…</button>
      </div>
    </ng-template>
    @if (resource.changedOnDisk()) {
      <div class="banner" role="alert">
        This file changed on disk.
        <button type="button" class="btn btn-default btn-s" (click)="reload()"><span>Discard mine and reload</span></button>
      </div>
    }
    @if (resource.error(); as error) {
      <gd-empty-state title="Can't open this file">
        <svg icon lucideFile [size]="20" aria-hidden="true"></svg>
        <p class="selectable">{{ error }}</p>
      </gd-empty-state>
    } @else if (resource.file()) {
      @if (preview()) {
        <div class="content-scroll">
          <div class="document">
            <article class="document-article">
              <gd-markdown [source]="value()" [path]="path()" [links]="wiki.linkTargets()" (linkClicked)="wiki.followLink($event)" />
            </article>
          </div>
        </div>
      } @else {
        <gd-code-editor [label]="'Contents of ' + path()" [path]="path()" [value]="value()" (valueChange)="draft.set($event)" (save)="save()" />
      }
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
  `,
})
export class FileEditor {
  readonly path = input.required<string>();
  /** Whether the file has uncommitted changes. */
  readonly changed = input(false);

  protected readonly wiki = inject(WikiActions);
  private readonly session = inject(Session);
  private readonly api = inject(WorkspaceApi);
  private readonly dialogs = inject(Dialogs);
  private readonly notifications = inject(Notifications);
  private readonly router = inject(Router);
  protected readonly mod = MOD_KEY;
  /** The edited text; null while it equals the file. */
  protected readonly draft = signal<string | null>(null);
  protected readonly preview = signal(false);
  protected readonly resource = fileResource("repo", this.path, computed(() => this.draft() !== null));
  protected readonly value = computed(() => this.draft() ?? this.resource.file()?.content ?? "");
  protected readonly dirty = computed(() => !!this.resource.file() && this.draft() !== null && this.draft() !== this.resource.file()!.content);
  protected readonly markdown = computed(() => /\.(md|markdown)$/i.test(this.path()));
  protected readonly folders = computed(() => this.path().split("/").slice(0, -1));
  protected readonly name = computed(() => this.path().split("/").at(-1)!);
  private saving = false;

  constructor() {
    trackUnsaved(this.dirty);
    hotkey("mod+s", () => void this.save());
  }

  protected async save() {
    const file = this.resource.file();
    if (!file || !this.dirty() || this.saving) return;
    this.saving = true;
    const content = this.draft()!;
    // The result applies before the snapshot refresh, so the file is clean at once.
    await this.session.run(async () => {
      const saved = await this.api.content.write("repo", this.path(), content, file.hash);
      this.resource.set(saved);
      // Keep whatever was typed while the save was in flight.
      this.draft.update((current) => (current === saved.content ? null : current));
    });
    this.saving = false;
  }

  protected async reload() {
    this.draft.set(null);
    await this.resource.reload();
  }

  protected copyPath() {
    void navigator.clipboard?.writeText(this.path());
    this.notifications.success("Path copied");
  }

  protected showChanges() {
    void this.router.navigate(["/changes"], { queryParams: { file: this.path() } });
  }

  protected async remove() {
    const confirmed = await this.dialogs.confirm({
      title: "Delete file",
      message: `Delete ${this.path()} from the working tree? Committed versions stay in Git history.`,
      confirm: "Delete",
      danger: true,
    });
    if (!confirmed) return;
    const deleted = await this.session.run(async () => (await this.api.content.remove("repo", this.path()), true), "File deleted");
    if (!deleted) return;
    this.draft.set(null);
    await this.router.navigate(["/code"], { replaceUrl: true });
  }
}
