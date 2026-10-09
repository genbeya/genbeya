import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from "@angular/core";
import { LucideColumns2, LucideFileText, LucidePencil, LucidePlus } from "@lucide/angular";
import { Dialogs } from "../../core/dialogs";
import { fileResource, stripFrontmatter } from "../../core/file-resource";
import { hotkey, MOD_KEY } from "../../core/hotkeys";
import { Session } from "../../core/session";
import { trackUnsaved } from "../../core/unsaved-changes";
import { WorkspaceApi } from "../../core/workspace-api";
import { CodeEditor } from "../../editor/code-editor";
import { MarkdownView } from "../../markdown/markdown-view";
import { EmptyState } from "../../ui/empty-state";
import { Breadcrumbs } from "./breadcrumbs";
import { PageMenu } from "./page-menu";
import { PageOutline } from "./page-outline";
import { WikiActions } from "./wiki-actions";
import { findPage, subpagesOf } from "./wiki-pages";

/** One wiki page: rendered for reading, or Markdown beside a live preview while editing (E). */
@Component({
  selector: "gd-wiki-page",
  imports: [
    Breadcrumbs,
    CodeEditor,
    EmptyState,
    MarkdownView,
    PageMenu,
    PageOutline,
    LucideColumns2,
    LucideFileText,
    LucidePencil,
    LucidePlus,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "view" },
  template: `
    @if (resource.error()) {
      <gd-empty-state title="This page does not exist">
        <svg icon lucideFileText [size]="20" aria-hidden="true"></svg>
        <p class="selectable">{{ path() }}</p>
        <button type="button" class="btn btn-primary btn-m" (click)="create()">
          <svg lucidePlus [size]="14" aria-hidden="true"></svg><span>Create it</span>
        </button>
      </gd-empty-state>
    } @else {
      <header class="view-header">
        <gd-breadcrumbs [path]="path()" />
        @if (dirty()) {
          <span class="dirty-dot" title="Unsaved changes" aria-label="Unsaved changes"></span>
        }
        <span class="grow"></span>
        @if (editing()) {
          <button
            type="button"
            class="icon-btn"
            aria-label="Toggle preview"
            title="Toggle preview"
            [class.is-active]="preview()"
            [attr.aria-pressed]="preview()"
            (click)="preview.set(!preview())"
          >
            <svg lucideColumns2 [size]="15" aria-hidden="true"></svg>
          </button>
          <button type="button" class="btn btn-ghost btn-m" (click)="cancel()"><span>Cancel</span></button>
          <button type="button" class="btn btn-primary btn-m" (click)="save(true)">
            <span>Save</span><kbd class="kbd">{{ mod }} S</kbd>
          </button>
        } @else {
          <button type="button" class="btn btn-default btn-m" [disabled]="!resource.file()" (click)="edit()">
            <svg lucidePencil [size]="13" aria-hidden="true"></svg><span>Edit</span><kbd class="kbd">E</kbd>
          </button>
          <gd-page-menu [path]="path()" />
        }
      </header>
      @if (resource.changedOnDisk()) {
        <div class="banner" role="alert">
          This page changed on disk while you were editing.
          <button type="button" class="btn btn-default btn-s" (click)="reload()"><span>Discard mine and reload</span></button>
        </div>
      }
      @if (editing() && resource.file()) {
        <div class="wiki-editor" [class.with-preview]="preview()">
          <gd-code-editor
            label="Page source"
            [path]="path()"
            [value]="draft()"
            [lineNumbers]="false"
            [autofocus]="true"
            (valueChange)="draft.set($event)"
            (save)="save(false)"
          />
          @if (preview()) {
            <div class="wiki-preview content-scroll">
              <gd-markdown [source]="stripFrontmatter(draft())" [path]="path()" [links]="links()" (linkClicked)="wiki.followLink($event)" />
            </div>
          }
        </div>
      } @else {
        <div class="content-scroll" #scroller>
          @if (resource.file(); as file) {
            <div class="document">
              <article class="document-article">
                <gd-markdown
                  [source]="stripFrontmatter(file.content)"
                  [path]="path()"
                  [links]="links()"
                  (linkClicked)="wiki.followLink($event)"
                  (rendered)="shown($event)"
                />
              </article>
              <gd-page-outline [content]="rendered()" [scroller]="scroller" />
            </div>
          }
        </div>
      }
    }
  `,
})
export class WikiPage {
  readonly path = input.required<string>();
  /** A heading to scroll to once the page is shown. */
  readonly anchor = input<string>();

  protected readonly wiki = inject(WikiActions);
  private readonly session = inject(Session);
  private readonly api = inject(WorkspaceApi);
  private readonly dialogs = inject(Dialogs);
  protected readonly mod = MOD_KEY;
  protected readonly stripFrontmatter = stripFrontmatter;
  protected readonly editing = signal(false);
  protected readonly preview = signal(true);
  protected readonly draft = signal("");
  protected readonly rendered = signal<{ element: HTMLElement } | null>(null);
  protected readonly resource = fileResource("content", this.path, this.editing);
  protected readonly dirty = computed(() => this.editing() && !!this.resource.file() && this.draft() !== this.resource.file()!.content);
  protected readonly links = computed(() => {
    const node = findPage(this.session.snapshot()?.wiki ?? [], this.path())?.node;
    return { ...this.wiki.linkTargets(), subpages: subpagesOf(node?.children ?? []) };
  });
  private saving = false;
  private scrolledTo: string | undefined;

  constructor() {
    trackUnsaved(this.dirty);
    hotkey(
      "e",
      () => this.edit(),
      computed(() => !this.editing() && !!this.resource.file()),
    );
    hotkey("mod+s", () => void this.save(false), this.editing);
    hotkey("escape", () => void this.cancel(), this.editing);
  }

  protected edit() {
    const file = this.resource.file();
    if (!file) return;
    this.draft.set(file.content);
    this.editing.set(true);
  }

  protected async save(close: boolean) {
    const file = this.resource.file();
    if (!file || this.saving) return;
    if (this.draft() !== file.content) {
      this.saving = true;
      // The result applies before the snapshot refresh, so the page is clean at once.
      const saved = await this.session.run(async () => {
        const result = await this.api.content.write("content", this.path(), this.draft(), file.hash);
        this.resource.set(result);
        return result;
      });
      this.saving = false;
      if (!saved) return;
      this.session.contentChanged();
    }
    if (close) this.editing.set(false);
  }

  protected async cancel() {
    if (this.dirty() && !(await this.dialogs.discardEdits("this page"))) return;
    this.editing.set(false);
  }

  protected async reload() {
    await this.resource.reload();
    this.editing.set(false);
  }

  protected async create() {
    const page = await this.session.run(() => this.api.content.createPage(this.path()));
    if (!page) return;
    this.session.contentChanged();
    await this.resource.reload();
  }

  /** Scrolls to the requested heading once, after the first render. */
  protected shown(element: HTMLElement) {
    this.rendered.set({ element });
    const anchor = this.anchor();
    if (anchor && anchor !== this.scrolledTo) {
      this.scrolledTo = anchor;
      element.querySelector(`#${CSS.escape(anchor)}`)?.scrollIntoView({ block: "start" });
    }
  }
}
