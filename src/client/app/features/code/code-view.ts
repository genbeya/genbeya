import { ChangeDetectionStrategy, Component, computed, type ElementRef, inject, input, signal, viewChild } from "@angular/core";
import { Router } from "@angular/router";
import { LucideCodeXml, LucideFile, LucideFilePlus2, LucideFolder, LucideSearch } from "@lucide/angular";
import type { LinkItem } from "../../../../contracts/gitdesk-link";
import type { FileNode } from "../../../../contracts/model";
import { Dialogs } from "../../core/dialogs";
import { hotkey, MOD_KEY } from "../../core/hotkeys";
import { Session } from "../../core/session";
import { WorkspaceApi } from "../../core/workspace-api";
import { parseLines } from "../../markdown/references";
import { EmptyState } from "../../ui/empty-state";
import { Resizable, ResizeHandle } from "../../ui/resizable";
import { filterTree, Tree, type TreeItem } from "../../ui/tree";
import { ShareMenu } from "../share/share-menu";
import { FileEditor } from "./file-editor";

/** The repository's files: a tree with change markers, and the open file (`?file=`). */
@Component({
  selector: "gd-code-view",
  imports: [
    EmptyState,
    FileEditor,
    Resizable,
    ResizeHandle,
    ShareMenu,
    Tree,
    LucideCodeXml,
    LucideFile,
    LucideFilePlus2,
    LucideFolder,
    LucideSearch,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "view" },
  template: `
    <div class="view-body">
      <aside class="side-panel" gdResizable="code-tree" [initial]="270" #panel="gdResizable" data-tour="code-tree">
        <div class="row panel-toolbar">
          <label class="filter grow">
            <svg lucideSearch [size]="13" aria-hidden="true"></svg>
            <input
              #filter
              placeholder="Filter files"
              aria-label="Filter files"
              [value]="query()"
              (input)="query.set(filter.value)"
              (keydown.escape)="clear(filter)"
            />
          </label>
          <button type="button" class="icon-btn" aria-label="New file" title="New file" (click)="createFile()">
            <svg lucideFilePlus2 [size]="15" aria-hidden="true"></svg>
          </button>
        </div>
        <div class="side-panel-scroll code-tree">
          <gd-share-menu #share="gdShareMenu" />
          <gd-tree
            label="Files"
            [items]="shown()"
            [selected]="file() ?? null"
            [expandAll]="!!query()"
            [rowMenu]="share.menu()"
            [rowMenuData]="fileLink"
            (selectItem)="open($event.key)"
          >
            <ng-template let-item>
              <span class="tree-icon">
                @if (item.children) {
                  <svg lucideFolder [size]="14" aria-hidden="true"></svg>
                } @else {
                  <svg lucideFile [size]="14" aria-hidden="true"></svg>
                }
              </span>
              <span class="tree-label">{{ item.label }}</span>
              @if (item.data; as letter) {
                <span class="tree-actions"
                  ><span class="status-letter {{ letter }}" [attr.aria-label]="'Status ' + letter">{{ letter }}</span></span
                >
              }
            </ng-template>
          </gd-tree>
          @if (query() && !shown().length) {
            <p class="tree-empty">No files match.</p>
          }
        </div>
      </aside>
      <div [gdResizeHandle]="panel"></div>
      <section class="main-pane">
        @if (file(); as path) {
          @for (key of [path]; track key) {
            <gd-file-editor [path]="path" [changed]="status().has(path)" [lines]="range()" />
          }
        } @else {
          <gd-empty-state title="Open a file">
            <svg icon lucideCodeXml [size]="20" aria-hidden="true"></svg>
            <p>Pick one from the tree, or press {{ mod }}+P to search.</p>
          </gd-empty-state>
        }
      </section>
    </div>
  `,
  styles: `
    .code-tree .tree-actions {
      display: flex;
    }
  `,
})
export class CodeView {
  readonly file = input<string>();
  /** `?lines=10-20` from a link to lines of the file. */
  readonly lines = input<string>();
  protected readonly range = computed(() => parseLines(this.lines() ? `L${this.lines()}` : undefined));
  private readonly session = inject(Session);
  private readonly api = inject(WorkspaceApi);
  private readonly dialogs = inject(Dialogs);
  private readonly router = inject(Router);
  protected readonly mod = MOD_KEY;
  protected readonly query = signal("");
  private readonly filter = viewChild.required<ElementRef<HTMLInputElement>>("filter");

  /** The change letter of every changed file: M, A, D, R or U (untracked). */
  protected readonly status = computed(() => {
    const letters = new Map<string, string>();
    for (const change of this.session.snapshot()!.changes)
      letters.set(change.path, change.index === "?" ? "U" : change.worktree !== " " ? change.worktree : change.index);
    return letters;
  });
  private readonly items = computed(() => {
    const status = this.status();
    const convert = (nodes: readonly FileNode[]): TreeItem<string | undefined>[] =>
      nodes.map((node) => ({
        key: node.path,
        label: node.name,
        data: status.get(node.path),
        ...(node.children ? { children: convert(node.children), selectable: false } : {}),
      }));
    return convert(this.session.snapshot()!.files);
  });
  protected readonly shown = computed(() => filterTree(this.items(), this.query()));
  /** Files can be shared; folders cannot. */
  protected readonly fileLink = (item: TreeItem<unknown>): LinkItem | null => (item.children ? null : { kind: "file", path: item.key });

  constructor() {
    hotkey("/", () => this.filter().nativeElement.focus());
  }

  protected open(file: string) {
    void this.router.navigate(["/code"], { queryParams: { file } });
  }

  protected clear(field: HTMLInputElement) {
    this.query.set("");
    field.blur();
  }

  protected async createFile() {
    const current = this.file();
    const path = await this.dialogs.prompt({
      title: "New file",
      label: "Path",
      initial: current?.includes("/") ? current.slice(0, current.lastIndexOf("/") + 1) : "",
      placeholder: "src/new-file.ts",
      confirm: "Create",
      hint: "Relative to the repository root. Folders are created as needed.",
    });
    if (!path) return;
    const created = await this.session.run(() => this.api.content.write("repo", path.replace(/^\/+/, ""), "", null));
    if (created) this.open(created.path);
  }
}
