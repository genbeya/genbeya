import { CdkContextMenuTrigger, CdkMenu, CdkMenuTrigger } from "@angular/cdk/menu";
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from "@angular/core";
import { Router } from "@angular/router";
import type { LinkItem } from "../../../../contracts/gitdesk-link";
import { Dialogs } from "../../core/dialogs";
import { Clipboard } from "../../core/clipboard";
import { fileResource } from "../../core/file-resource";
import { hotkey, MOD_KEY } from "../../core/hotkeys";
import { Session } from "../../core/session";
import { ShareLinks } from "../../core/share-links";
import { trackUnsaved } from "../../core/unsaved-changes";
import { WorkspaceApi } from "../../core/workspace-api";
import { CodeEditor, type LineRange } from "../../editor/code-editor";
import { MarkdownView } from "../../markdown/markdown-view";
import { EmptyState } from "../../ui/empty-state";
import { Icon } from "../../ui/icon";
import { MenuItem } from "../../ui/menu-item";
import { ShareMenu } from "../share/share-menu";
import { WikiActions } from "../wiki/wiki-actions";

/** One repository file in the editor; Markdown can also be previewed. */
@Component({
  selector: "gd-file-editor",
  imports: [CdkContextMenuTrigger, CdkMenu, CdkMenuTrigger, CodeEditor, EmptyState, Icon, MarkdownView, MenuItem, ShareMenu],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "view" },
  template: `
    <gd-share-menu #share="gdShareMenu" />
    <header class="view-header" [cdkContextMenuTriggerFor]="share.menu()" [cdkContextMenuTriggerData]="{ $implicit: link() }">
      <div class="view-title code-path" [attr.aria-label]="path()">
        @for (segment of folders(); track $index) {
          <span class="row crumb-row"
            ><span class="crumb">{{ segment }}</span
            ><svg gd-icon name="chevron-right" [size]="12" class="crumb-sep"></svg
          ></span>
        }
        <span>{{ name() }}</span>
      </div>
      @if (dirty()) {
        <span class="dirty-dot" title="Unsaved changes" aria-label="Unsaved changes"></span>
      }
      <span class="grow"></span>
      @if (markdown()) {
        <div class="segmented" role="radiogroup" aria-label="Mode">
          <button type="button" role="radio" [attr.aria-checked]="!preview()" [class.is-active]="!preview()" (click)="preview.set(false)">
            <svg gd-icon name="pencil" [size]="12"></svg> Edit
          </button>
          <button type="button" role="radio" [attr.aria-checked]="preview()" [class.is-active]="preview()" (click)="preview.set(true)">
            <svg gd-icon name="eye" [size]="12"></svg> Preview
          </button>
        </div>
      }
      <button
        type="button"
        class="btn btn-m"
        [class.btn-primary]="dirty()"
        [class.btn-default]="!dirty()"
        [disabled]="!dirty()"
        (click)="save()"
      >
        <span>Save</span><kbd class="kbd">{{ mod }} S</kbd>
      </button>
      <button
        type="button"
        class="icon-btn"
        aria-label="File actions"
        title="File actions"
        [cdkMenuTriggerFor]="actions"
        #trigger="cdkMenuTriggerFor"
        [class.is-active]="trigger.isOpen()"
      >
        <svg gd-icon name="ellipsis" [size]="16"></svg>
      </button>
    </header>
    <ng-template #actions>
      <div class="menu" cdkMenu>
        <button gd-menu-item (selected)="copyPath()"><svg icon gd-icon name="copy" [size]="14"></svg>Copy path</button>
        <button
          gd-menu-item
          [disabled]="!!links.unavailable()"
          [attr.title]="links.unavailable()"
          (selected)="links.copyGitdeskLink(link())"
        >
          <svg icon gd-icon name="link" [size]="14"></svg>Copy GitDesk link
        </button>
        @if (links.webLink(link())) {
          <button gd-menu-item (selected)="links.copyWebLink(link())">
            <svg icon gd-icon name="globe" [size]="14"></svg>Copy web link
          </button>
        }
        <button gd-menu-item [disabled]="!changed()" (selected)="showChanges()">
          <svg icon gd-icon name="file-diff" [size]="14"></svg>Show changes
        </button>
        <div class="menu-separator"></div>
        <button gd-menu-item [danger]="true" (selected)="remove()"><svg icon gd-icon name="trash-2" [size]="14"></svg>Delete file…</button>
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
        <svg icon gd-icon name="file" [size]="20"></svg>
        <p class="selectable">{{ error }}</p>
      </gd-empty-state>
    } @else if (resource.file()) {
      @if (preview()) {
        <div class="content-scroll">
          <div class="document">
            <article class="document-article">
              <gd-markdown
                scope="repo"
                [source]="value()"
                [path]="path()"
                [links]="wiki.linkTargets()"
                (linkClicked)="wiki.followLink($event)"
              />
            </article>
          </div>
        </div>
      } @else {
        <gd-code-editor
          [label]="'Contents of ' + path()"
          [path]="path()"
          [value]="value()"
          [reveal]="lines()"
          [references]="markdown() ? wiki.referenceCandidates() : null"
          [people]="markdown() ? wiki.people() : null"
          [minimap]="session.preferences().minimap"
          (valueChange)="draft.set($event)"
          (save)="save()"
        />
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
  /** Lines to show, from a link. */
  readonly lines = input<LineRange | null>(null);

  protected readonly wiki = inject(WikiActions);
  protected readonly links = inject(ShareLinks);
  protected readonly link = computed<LinkItem>(() => ({ kind: "file", path: this.path() }));
  protected readonly session = inject(Session);
  private readonly api = inject(WorkspaceApi);
  private readonly dialogs = inject(Dialogs);
  private readonly clipboard = inject(Clipboard);
  private readonly router = inject(Router);
  protected readonly mod = MOD_KEY;
  /** The edited text; null while it equals the file. */
  protected readonly draft = signal<string | null>(null);
  protected readonly preview = signal(false);
  protected readonly resource = fileResource(
    "repo",
    this.path,
    computed(() => this.draft() !== null),
  );
  protected readonly value = computed(() => this.draft() ?? this.resource.file()?.content ?? "");
  protected readonly dirty = computed(
    () => !!this.resource.file() && this.draft() !== null && this.draft() !== this.resource.file()!.content,
  );
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
    void this.clipboard.copy(this.path(), "Path");
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
