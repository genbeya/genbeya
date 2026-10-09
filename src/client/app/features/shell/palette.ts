import { DIALOG_DATA, DialogRef } from "@angular/cdk/dialog";
import { afterRenderEffect, ChangeDetectionStrategy, Component, computed, type ElementRef, inject, signal, viewChild } from "@angular/core";
import { Router } from "@angular/router";
import type { RecentEntry } from "../../../../contracts/model";
import { MOD_KEY } from "../../core/hotkeys";
import { Session } from "../../core/session";
import { MANAGERS } from "../../platform/platform";
import { WikiActions } from "../wiki/wiki-actions";
import { PaletteIcon } from "./palette-icon";
import { allItems, branchItems, rank, type PaletteCommands, type PaletteItem } from "./palette-items";
import { RepositoryActions } from "./repository-actions";
import { ShellUi, type PaletteMode } from "./shell-ui";

/** Search and commands (Ctrl+K), or the branch switcher. */
@Component({
  selector: "gd-palette",
  imports: [PaletteIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: "./palette.css",
  template: `
    <div class="palette" role="dialog" [attr.aria-label]="mode === 'branches' ? 'Switch branch' : 'Command palette'">
      <input
        #field
        class="palette-input"
        role="combobox"
        aria-expanded="true"
        aria-controls="palette-results"
        [attr.aria-activedescendant]="results()[active()] ? 'palette-' + active() : null"
        spellcheck="false"
        [placeholder]="mode === 'branches' ? 'Switch to branch…' : 'Search pages, tasks, files and commands…'"
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
  private readonly ui = inject(ShellUi);
  protected readonly query = signal("");
  protected readonly active = signal(0);
  private readonly recent = signal<readonly RecentEntry[]>([]);
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
    sync: (action, remote) => void this.repository.sync(action, remote),
    syncContent: () => void this.repository.syncContent(),
    pickFolder: () => void this.session.pick(),
    openRemote: () => void this.ui.openRemote(),
    openClone: () => void this.ui.openClone(),
    closeRepository: () => void this.session.close(),
    openRecent: (entry) => void this.session.open(entry.location),
    setTheme: (theme) => void this.session.setPreferences({ theme }),
    showHelp: () => void this.ui.showHelp(),
  };

  private readonly items = computed<PaletteItem[]>(() => {
    const snapshot = this.session.snapshot()!;
    return this.mode === "branches"
      ? branchItems(snapshot, this.query(), this.commands)
      : allItems(snapshot, this.recent(), this.session.preferences().theme, MOD_KEY, this.commands);
  });
  protected readonly results = computed(() => rank(this.items(), this.query(), this.mode === "branches"));

  constructor() {
    void inject(MANAGERS)
      .workspace.recent()
      .then((recent) => this.recent.set(recent));
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
