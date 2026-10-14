import { CdkContextMenuTrigger, CdkMenu, CdkMenuTrigger } from "@angular/cdk/menu";
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, viewChild, type ElementRef } from "@angular/core";
import { Router } from "@angular/router";
import type { LinkItem } from "../../../../contracts/genbeya-link";
import { Dialogs } from "../../core/dialogs";
import { Clipboard } from "../../core/clipboard";
import { fileResource } from "../../core/file-resource";
import { hotkey, MOD_KEY } from "../../core/hotkeys";
import { Session } from "../../core/session";
import { ShareLinks } from "../../core/share-links";
import { trackUnsaved } from "../../core/unsaved-changes";
import { WorkspaceApi } from "../../core/workspace-api";
import { CodeEditor, type LineRange } from "../../editor/code-editor";
import { ScrollLink } from "../../editor/scroll-link";
import { MarkdownView } from "../../markdown/markdown-view";
import { previewTopLine, scrollPreviewToLine } from "../../markdown/source-lines";
import { EmptyState } from "../../ui/empty-state";
import { Icon } from "../../ui/icon";
import type { IconName } from "../../ui/icon-data";
import { MenuItem } from "../../ui/menu-item";
import { ShareMenu } from "../share/share-menu";
import { WikiActions } from "../wiki/wiki-actions";
import { previewKind, previewMarkdown } from "./preview-kinds";

type Mode = "edit" | "split" | "preview";

const MODES: readonly { readonly mode: Mode; readonly label: string; readonly icon: IconName }[] = [
  { mode: "edit", label: "Edit", icon: "pencil" },
  { mode: "split", label: "Split", icon: "columns-2" },
  { mode: "preview", label: "Preview", icon: "eye" },
];

/** The mode files with a preview open in: the one chosen last, for as long as the app runs. */
const lastMode = signal<Mode>("edit");
const PREVIEW_DELAY = 150;

/** One repository file in the editor; Markdown, diagram sources and SVG can also be previewed, beside the text or instead of it. */
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
      @if (kind()) {
        <div class="segmented" role="radiogroup" aria-label="Mode">
          @for (choice of modes; track choice.mode) {
            <button
              type="button"
              role="radio"
              [attr.aria-checked]="mode() === choice.mode"
              [class.is-active]="mode() === choice.mode"
              (click)="setMode(choice.mode)"
            >
              <svg gd-icon [name]="choice.icon" [size]="12"></svg> {{ choice.label }}
            </button>
          }
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
          (selected)="links.copyGenbeyaLink(link())"
        >
          <svg icon gd-icon name="link" [size]="14"></svg>Copy Genbeya link
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
      <div class="file-body" [class.is-split]="showsEditor() && showsPreview()">
        @if (showsEditor()) {
          <gd-code-editor
            #editor
            [label]="'Contents of ' + path()"
            [path]="path()"
            [value]="value()"
            [reveal]="lines()"
            [references]="markdown() ? wiki.referenceCandidates() : null"
            [people]="markdown() ? wiki.people() : null"
            [minimap]="session.preferences().minimap && !showsPreview()"
            [startLine]="startLine"
            (valueChange)="draft.set($event)"
            (save)="save()"
            (scrolled)="editorScrolled($event)"
          />
        }
        @if (showsPreview()) {
          <div class="content-scroll file-preview" #previewScroller (scroll)="previewScrolled()">
            @if (kind() === "svg") {
              @if (svgUrl(); as url) {
                <div class="svg-preview"><img [src]="url" [alt]="'Preview of ' + name()" /></div>
              }
            } @else {
              <div class="document">
                <article class="document-article">
                  <gd-markdown
                    scope="repo"
                    [source]="previewSource()"
                    [path]="path()"
                    [links]="wiki.linkTargets()"
                    [lineOffset]="kind() === 'markdown' ? 0 : undefined"
                    (linkClicked)="wiki.followLink($event)"
                    (rendered)="previewShown()"
                  />
                </article>
              </div>
            }
          </div>
        }
      </div>
    }
  `,
  styles: `
    .file-body {
      display: flex;
      flex: 1;
      min-height: 0;
    }
    .file-body > * {
      flex: 1;
      min-width: 0;
    }
    .file-body.is-split {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
    .file-body.is-split .file-preview {
      border-left: 1px solid var(--line);
    }
    .svg-preview {
      display: flex;
      justify-content: center;
      padding: 32px;
    }
    .svg-preview img {
      max-width: 100%;
      height: auto;
      background: repeating-conic-gradient(var(--bg-hover) 0 25%, transparent 0 50%) 0 0 / 16px 16px;
    }
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
  protected readonly modes = MODES;
  protected readonly kind = computed(() => previewKind(this.path()));
  /** Files without a preview are only edited. */
  protected readonly mode = computed<Mode>(() => (this.kind() ? lastMode() : "edit"));
  protected readonly showsEditor = computed(() => this.mode() !== "preview");
  protected readonly showsPreview = computed(() => this.mode() !== "edit");
  /** Beside the editor the preview catches up once typing pauses; on its own it shows the text at once. */
  private readonly previewText = computed(() => {
    const kind = this.kind();
    return kind && kind !== "svg" ? previewMarkdown(kind, this.value()) : "";
  });
  /** The preview text once typing pauses; set by an effect, since the inputs it depends on come after construction. */
  private readonly settledText = signal("");
  protected readonly previewSource = computed(() => (this.showsEditor() ? this.settledText() : this.previewText()));
  /** An SVG file as an image, which can't run its scripts. */
  protected readonly svgUrl = signal<string | null>(null);
  private readonly editor = viewChild<CodeEditor>("editor");
  private readonly previewScroller = viewChild<ElementRef<HTMLElement>>("previewScroller");
  /** The source line the editor opens at after switching modes. */
  protected startLine: number | null = null;
  /** The source line the preview opens at after switching modes. */
  private previewLine: number | null = null;
  private readonly scrolling = new ScrollLink();
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
    let settled = false;
    effect((onCleanup) => {
      const text = this.previewText();
      // The first text shows at once; later ones once typing pauses.
      if (!settled) {
        settled = true;
        return this.settledText.set(text);
      }
      const timer = setTimeout(() => this.settledText.set(text), PREVIEW_DELAY);
      onCleanup(() => clearTimeout(timer));
    });
    effect((onCleanup) => {
      if (this.kind() !== "svg" || !this.showsPreview()) return this.svgUrl.set(null);
      const url = URL.createObjectURL(new Blob([this.value()], { type: "image/svg+xml" }));
      this.svgUrl.set(url);
      onCleanup(() => URL.revokeObjectURL(url));
    });
  }

  /** Switches between editing, both side by side and the preview, keeping the place in Markdown. */
  protected setMode(mode: Mode) {
    const preview = this.previewScroller()?.nativeElement;
    const line = this.showsEditor() ? (this.editor()?.topLine() ?? null) : preview ? previewTopLine(preview) : null;
    this.startLine = this.previewLine = this.kind() === "markdown" ? line : null;
    lastMode.set(mode);
  }

  protected editorScrolled(line: number) {
    const preview = this.previewScroller()?.nativeElement;
    if (preview && this.kind() === "markdown") this.scrolling.moved("editor", () => scrollPreviewToLine(preview, line));
  }

  protected previewScrolled() {
    const preview = this.previewScroller()?.nativeElement;
    const line = preview && this.kind() === "markdown" && this.showsEditor() ? previewTopLine(preview) : null;
    if (line) this.scrolling.moved("preview", () => this.editor()?.scrollToLine(line));
  }

  /** The preview opens where the editor was. */
  protected previewShown() {
    const preview = this.previewScroller()?.nativeElement;
    // The first render may come before the text: wait for one with source lines.
    if (!preview || this.previewLine === null || !preview.querySelector("[data-line]")) return;
    const line = this.previewLine;
    this.previewLine = null;
    this.scrolling.moved("editor", () => scrollPreviewToLine(preview, line));
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
