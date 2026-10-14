import { CdkContextMenuTrigger } from "@angular/cdk/menu";
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from "@angular/core";
import { Dialogs } from "../../core/dialogs";
import { fileResource, stripFrontmatter } from "../../core/file-resource";
import { hotkey, MOD_KEY } from "../../core/hotkeys";
import { Session } from "../../core/session";
import { trackUnsaved } from "../../core/unsaved-changes";
import { debounced, sameJson } from "../../core/signals";
import { WorkspaceApi } from "../../core/workspace-api";
import { CodeEditor } from "../../editor/code-editor";
import { headingAt } from "../../markdown/headings";
import { MarkdownView } from "../../markdown/markdown-view";
import { EmptyState } from "../../ui/empty-state";
import { Icon } from "../../ui/icon";
import { ShareMenu } from "../share/share-menu";
import { Breadcrumbs } from "./breadcrumbs";
import { PageMenu } from "./page-menu";
import { PageOutline } from "./page-outline";
import { WikiActions } from "./wiki-actions";
import { findPage, subpagesOf } from "./wiki-pages";

/** One wiki page: rendered for reading, or Markdown beside a live preview while editing (E). */
const PREVIEW_DELAY = 150;

@Component({
  selector: "gd-wiki-page",
  imports: [Breadcrumbs, CdkContextMenuTrigger, CodeEditor, EmptyState, Icon, MarkdownView, PageMenu, PageOutline, ShareMenu],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "view" },
  template: `
    @if (resource.error()) {
      <gd-empty-state title="This page does not exist">
        <svg icon gd-icon name="file-text" [size]="20"></svg>
        <p class="selectable">{{ path() }}</p>
        <button type="button" class="btn btn-primary btn-m" (click)="create()">
          <svg gd-icon name="plus" [size]="14"></svg><span>Create it</span>
        </button>
      </gd-empty-state>
    } @else {
      <gd-share-menu #share="gdShareMenu" />
      <header
        class="view-header"
        data-tour="page-header"
        [cdkContextMenuTriggerFor]="share.menu()"
        [cdkContextMenuTriggerData]="{ $implicit: { kind: 'page', path: path() } }"
      >
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
            <svg gd-icon name="columns-2" [size]="15"></svg>
          </button>
          <button type="button" class="btn btn-ghost btn-m" (click)="cancel()"><span>Cancel</span></button>
          <!-- Save while there is something to save; Done closes the editor once everything is saved. -->
          @if (dirty()) {
            <button type="button" class="btn btn-primary btn-m" (click)="save(true)">
              <span>Save</span><kbd class="kbd">{{ mod }} S</kbd>
            </button>
          } @else {
            <button type="button" class="btn btn-default btn-m" (click)="save(true)"><span>Done</span></button>
          }
        } @else {
          <button type="button" class="btn btn-default btn-m" data-tour="wiki-edit" [disabled]="!resource.file()" (click)="edit()">
            <svg gd-icon name="pencil" [size]="13"></svg><span>Edit</span><kbd class="kbd">E</kbd>
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
            [references]="wiki.referenceCandidates()"
            [people]="wiki.people()"
            [lineNumbers]="false"
            [autofocus]="true"
            (valueChange)="draft.set($event)"
            (save)="save(false)"
          />
          @if (preview()) {
            <div class="wiki-preview content-scroll">
              <gd-markdown [source]="previewSource()" [path]="path()" [links]="links()" (linkClicked)="wiki.followLink($event)" />
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
  /** Without an anchor, a line of the file whose section to scroll to. */
  readonly line = input<string>();

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
  protected readonly links = computed(
    () => {
      const node = findPage(this.session.snapshot()?.wiki ?? [], this.path())?.node;
      return { ...this.wiki.linkTargets(), subpages: subpagesOf(node?.children ?? []) };
    },
    { equal: sameJson },
  );
  /** The live preview catches up once typing pauses. */
  protected readonly previewSource = debounced(
    computed(() => stripFrontmatter(this.draft())),
    PREVIEW_DELAY,
  );
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
    // Scrolls to the requested heading or line once it is rendered, and again when another one is requested.
    effect(() => {
      const element = this.rendered()?.element;
      const anchor = this.anchor();
      const target = anchor ?? (this.line() ? `line ${this.line()}` : undefined);
      if (!element || !target || target === this.scrolledTo) return;
      this.scrolledTo = target;
      const id = anchor ?? untracked(() => this.headingAtLine());
      if (id) element.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ block: "start" });
    });
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

  protected shown(element: HTMLElement) {
    this.rendered.set({ element });
  }

  /** The heading above `line`, which counts the frontmatter that is not rendered. */
  private headingAtLine(): string | null {
    const content = this.resource.file()?.content;
    const line = Number(this.line());
    if (!content || !(line > 0)) return null;
    const source = stripFrontmatter(content);
    const hidden = content.split("\n").length - source.split("\n").length;
    return headingAt(source, line - hidden);
  }
}
