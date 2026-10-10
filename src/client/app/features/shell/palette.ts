import { DIALOG_DATA, DialogRef } from "@angular/cdk/dialog";
import { afterRenderEffect, ChangeDetectionStrategy, Component, computed, type ElementRef, inject, signal, viewChild } from "@angular/core";
import { Router } from "@angular/router";
import { CTRL_KEY, MOD_KEY } from "../../core/hotkeys";
import { Repositories } from "../../core/repositories";
import { Session } from "../../core/session";
import { Terminals } from "../../core/terminals";
import { WikiActions } from "../wiki/wiki-actions";
import { PaletteIcon } from "./palette-icon";
import { allItems, branchItems, linkItem, mergeItems, rank, type PaletteCommands, type PaletteItem } from "./palette-items";
import { OperationActions } from "../operations/operation-actions";
import { RepositoryActions } from "./repository-actions";
import { ShellUi, type PaletteMode } from "./shell-ui";

/** Search and commands (Ctrl+K), or the branch switcher. */
@Component({
  selector: "gd-palette",
  imports: [PaletteIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: "./palette.css",
  template: `
    <div class="palette" role="dialog" [attr.aria-label]="label">
      <input
        #field
        class="palette-input"
        role="combobox"
        aria-expanded="true"
        aria-controls="palette-results"
        [attr.aria-activedescendant]="results()[active()] ? 'palette-' + active() : null"
        spellcheck="false"
        [placeholder]="placeholder"
        [value]="query()"
        (input)="search(field.value)"
        (keydown)="key($event)"
      />
      <div class="palette-list" id="palette-results" role="listbox" #list>
        @for (item of results(); track item.id; let index = $index) {
          @if (index === 0 || results()[index - 1]!.group !== item.group) {
            <div class="palette-group" role="presentation">{{ item.group }}</div>
          }
          <button
            type="button"
            role="option"
            tabindex="-1"
            class="palette-item"
            [id]="'palette-' + index"
            [class.is-active]="index === active()"
            [attr.aria-selected]="index === active()"
            (mousemove)="active.set(index)"
            (click)="choose(item)"
          >
            <span class="palette-icon"><gd-palette-icon [icon]="item.icon" /></span>
            <span class="ellipsis">{{ item.label }}</span>
            @if (item.detail) {
              <span class="palette-detail ellipsis">{{ item.detail }}</span>
            }
            <span class="grow"></span>
            @if (item.hint) {
              <span class="palette-hint"
                ><kbd class="kbd">{{ item.hint }}</kbd></span
              >
            }
          </button>
        } @empty {
          <div class="palette-empty">No matches</div>
        }
      </div>
    </div>
  `,
})
export class Palette {
  protected readonly mode = inject<PaletteMode>(DIALOG_DATA);
  private readonly dialog = inject(DialogRef);
  private readonly session = inject(Session);
  private readonly router = inject(Router);
  private readonly wiki = inject(WikiActions);
  private readonly repository = inject(RepositoryActions);
  private readonly operations = inject(OperationActions);
  private readonly ui = inject(ShellUi);
  private readonly terminals = inject(Terminals);
  protected readonly label = { all: "Command palette", branches: "Switch branch", merge: "Merge branch" }[this.mode];
  protected readonly placeholder = {
    all: "Search pages, tasks, files and commands…",
    branches: "Switch to branch…",
    merge: `Merge into ${this.session.snapshot()?.head.branch ?? "the current branch"}…`,
  }[this.mode];
  protected readonly query = signal("");
  protected readonly active = signal(0);
  private readonly recent = inject(Repositories).recent;
  private readonly list = viewChild.required<ElementRef<HTMLElement>>("list");
  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>("field");

  private readonly commands: PaletteCommands = {
    go: (view) => void this.router.navigate([`/${view}`]),
    openPage: (path) => void this.wiki.openPage(path),
    openTask: (task) => void this.router.navigate(["/tasks"], { queryParams: { task } }),
    openFile: (file) => void this.router.navigate(["/code"], { queryParams: { file } }),
    newPage: () => void this.wiki.createPage(),
    newTask: () => void this.router.navigate(["/tasks"], { queryParams: { create: this.session.snapshot()!.settings.statuses[0] } }),
    switchBranch: (name) => void this.repository.switchBranch(name),
    createBranch: (name) => void this.repository.createBranch(name),
    showBranches: () => void this.ui.openPalette("branches"),
    merge: (source, kind) => void this.operations.merge(source, kind),
    showMerge: () => void this.ui.openPalette("merge"),
    sync: (action, remote) => void this.repository.sync(action, remote),
    syncContent: () => void this.repository.syncContent(),
    pickFolder: () => void this.session.pick(),
    openRemote: () => void this.ui.openRemote(),
    openClone: () => void this.ui.openClone(),
    closeRepository: () => void this.session.close(),
    openRecent: (entry) => void this.session.open(entry.location),
    setTheme: (theme) => void this.session.setPreferences({ theme }),
    showHelp: () => void this.ui.showHelp(),
    toggleTerminal: () => void this.terminals.toggle(),
    openLink: (link) => void this.ui.openLink(link),
  };

  private readonly items = computed<PaletteItem[]>(() => {
    const snapshot = this.session.snapshot()!;
    if (this.mode === "branches") return branchItems(snapshot, this.query(), this.commands);
    if (this.mode === "merge") return mergeItems(snapshot, this.commands);
    return allItems(snapshot, this.recent(), this.session.preferences().theme, { mod: MOD_KEY, ctrl: CTRL_KEY }, this.commands);
  });
  protected readonly results = computed(() => {
    const link = this.mode === "all" ? linkItem(this.query(), this.commands) : null;
    return link ? [link] : rank(this.items(), this.query(), this.mode !== "all");
  });

  constructor() {
    afterRenderEffect(() => {
      this.active();
      this.list().nativeElement.querySelector(".palette-item.is-active")?.scrollIntoView({ block: "nearest" });
    });
    afterRenderEffect(() => this.field().nativeElement.focus());
  }

  protected search(value: string) {
    this.query.set(value);
    this.active.set(0);
  }

  protected key(event: KeyboardEvent) {
    const count = Math.max(1, this.results().length);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      this.active.update((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + count) % count);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = this.results()[this.active()];
      if (item) this.choose(item);
    }
  }

  protected choose(item: PaletteItem) {
    this.dialog.close();
    item.run();
  }
}
