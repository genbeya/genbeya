/** Chooses a folder on WSL or SSH, where the system folder dialog does not reach. */
import { DIALOG_DATA, DialogRef } from "@angular/cdk/dialog";
import { afterRenderEffect, ChangeDetectionStrategy, Component, computed, type ElementRef, inject, signal, viewChild } from "@angular/core";
import type { Folder, FolderListing, RemoteLocation } from "../../../../contracts/model";
import { messageOf } from "../../core/notifications";
import { Repositories } from "../../core/repositories";
import { DialogFrame } from "../../ui/dialog-frame";
import { Icon } from "../../ui/icon";
import { recall, remember } from "../../ui/remembered";

export interface FolderBrowserOptions {
  /** The machine, and the folder to start in: absolute, or empty for the home folder. */
  readonly location: RemoteLocation;
  /** Offers to open a selected Git repository right away. */
  readonly openRepositories?: boolean;
}

export interface FolderChoice {
  readonly path: string;
  /** The user chose to open the repository at `path` right away. */
  readonly open: boolean;
}

const SHOW_HIDDEN = "genbeya.folder-browser.hidden";
/** Keys typed within this many milliseconds search together. */
const TYPE_AHEAD = 700;

const childPath = (parent: string, name: string) => (parent === "/" ? `/${name}` : `${parent}/${name}`);

/** The parent of an absolute path that could not be listed; null for the root and the home folder. */
const parentOf = (path: string) => (/^\/.*[^/]/.test(path) ? path.replace(/\/*[^/]+\/*$/, "") || "/" : null);

@Component({
  selector: "gd-folder-browser",
  imports: [DialogFrame, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: "./folder-browser.css",
  template: `
    <gd-dialog-frame [title]="title" [width]="560" (submitted)="submit()">
      <div class="browser-bar">
        <button
          type="button"
          class="icon-btn"
          aria-label="Up one folder"
          title="Up one folder"
          [disabled]="parent() === null"
          (click)="up()"
        >
          <svg gd-icon name="arrow-up" [size]="15"></svg>
        </button>
        <button type="button" class="icon-btn" aria-label="Home folder" title="Home folder" (click)="load('')">
          <svg gd-icon name="house" [size]="15"></svg>
        </button>
        <input
          #field
          class="input mono"
          aria-label="Folder path"
          spellcheck="false"
          placeholder="/home/me"
          [value]="typed()"
          (input)="typed.set(field.value)"
          (keydown.enter)="go($event)"
        />
      </div>
      <div class="browser-pane" [class.is-loading]="loading()">
        <div
          #list
          class="browser-list"
          role="listbox"
          tabindex="0"
          cdkFocusInitial
          [attr.aria-label]="'Folders in ' + (listing()?.path ?? typed())"
          [attr.aria-busy]="loading()"
          [attr.aria-activedescendant]="active() >= 0 ? 'browser-folder-' + active() : null"
          (keydown)="key($event)"
        >
          @for (folder of folders(); track folder.name; let index = $index) {
            <button
              type="button"
              role="option"
              tabindex="-1"
              class="browser-item"
              [id]="'browser-folder-' + index"
              [class.is-active]="index === active()"
              [attr.aria-selected]="index === active()"
              (mousedown)="$event.preventDefault()"
              (click)="select(index)"
              (dblclick)="enter(folder)"
            >
              @if (folder.repository) {
                <svg gd-icon name="folder-git-2" [size]="15" class="browser-icon is-repository"></svg>
              } @else {
                <svg gd-icon name="folder" [size]="15" class="browser-icon"></svg>
              }
              <span class="browser-name ellipsis">{{ folder.name }}</span>
              @if (folder.repository) {
                <span class="browser-repo">Git repository</span>
              }
            </button>
          }
        </div>
        @if (error(); as message) {
          <p class="browser-message dialog-error" role="alert">{{ message }}</p>
        } @else if (listing() && !folders().length) {
          <p class="browser-message">No folders here.</p>
        }
      </div>
      <p class="browser-status" role="status">{{ status() }}</p>
      <footer>
        <label class="checkbox browser-hidden">
          <input #hidden type="checkbox" [checked]="showHidden()" (change)="toggleHidden(hidden.checked)" />
          Show hidden folders
        </label>
        <button type="button" class="btn btn-default btn-m" (click)="dialog.close()"><span>Cancel</span></button>
        @if (repository(); as selected) {
          <button type="button" class="btn btn-default btn-m" (click)="chooseCurrent()"><span>Select this folder</span></button>
          <button type="submit" class="btn btn-primary btn-m">
            <span>Open {{ selected.name }}</span>
          </button>
        } @else {
          <button type="submit" class="btn btn-primary btn-m" [disabled]="!listing()"><span>Select this folder</span></button>
        }
      </footer>
    </gd-dialog-frame>
  `,
})
export class FolderBrowser {
  private readonly options = inject<FolderBrowserOptions>(DIALOG_DATA);
  protected readonly dialog = inject<DialogRef<FolderChoice>>(DialogRef);
  private readonly repositories = inject(Repositories);
  protected readonly title = `Choose a folder on ${
    this.options.location.kind === "wsl" ? `WSL (${this.options.location.distro})` : this.options.location.host
  }`;
  /** The path field; follows the listed folder. */
  protected readonly typed = signal(this.options.location.path);
  /** The path last asked for; differs from the listing's while loading or after a failure. */
  private readonly requested = signal(this.options.location.path);
  protected readonly listing = signal<FolderListing | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly showHidden = signal(recall(SHOW_HIDDEN) === "true");
  /** The selected folder's index in {@link folders}, or -1. */
  protected readonly active = signal(-1);
  protected readonly folders = computed(() => {
    const all = this.listing()?.folders ?? [];
    return this.showHidden() ? all : all.filter((folder) => !folder.name.startsWith("."));
  });
  /** Where "Up" goes; a folder that could not be listed still has one. */
  protected readonly parent = computed(() => {
    const listing = this.listing();
    return listing ? listing.parent : parentOf(this.requested());
  });
  /** The selected Git repository, when the dialog may open it right away. */
  protected readonly repository = computed(() => {
    const folder = this.folders()[this.active()];
    return this.options.openRepositories && folder?.repository ? folder : null;
  });
  protected readonly status = computed(() => {
    const listing = this.listing();
    if (this.loading()) return "Loading…";
    if (!listing) return "";
    const shown = this.folders().length;
    const hidden = listing.folders.length - shown;
    return (
      `${shown} ${shown === 1 ? "folder" : "folders"}` +
      (hidden ? `, ${hidden} hidden` : "") +
      (listing.truncated ? `. Only the first ${listing.folders.length} are listed; type a path to go further.` : "")
    );
  });
  private readonly list = viewChild.required<ElementRef<HTMLElement>>("list");
  /** Numbers listings, so a slow one cannot overwrite a newer one. */
  private ticket = 0;
  private search = "";
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    // The dialog focuses the list first ([cdkFocusInitial]), so arrow keys work right away.
    void this.load(this.options.location.path);
    // Keeps the selection in view; a folder without one starts at the top.
    afterRenderEffect(() => {
      this.listing();
      this.active();
      const list = this.list().nativeElement;
      const selected = list.querySelector(".browser-item.is-active");
      if (selected) selected.scrollIntoView({ block: "nearest" });
      else list.scrollTop = 0;
    });
  }

  /** Lists `path` (empty for the home folder), selecting the subfolder named `select`. */
  protected async load(path: string, select?: string): Promise<void> {
    const ticket = ++this.ticket;
    this.requested.set(path);
    this.loading.set(true);
    this.error.set(null);
    try {
      const listing = await this.repositories.browse({ ...this.options.location, path });
      if (ticket !== this.ticket) return;
      this.listing.set(listing);
      this.typed.set(listing.path);
      this.active.set(select === undefined ? -1 : this.folders().findIndex((folder) => folder.name === select));
    } catch (error) {
      if (ticket !== this.ticket) return;
      this.listing.set(null);
      this.active.set(-1);
      this.error.set(messageOf(error));
      if (path) this.typed.set(path);
    } finally {
      if (ticket === this.ticket) this.loading.set(false);
    }
  }

  /** Enter in the path field goes there; it never chooses the folder. */
  protected go(event: Event) {
    event.preventDefault();
    void this.load(this.typed().trim());
  }

  protected up() {
    const parent = this.parent();
    const current = this.listing()?.path;
    if (parent !== null) void this.load(parent, current?.slice(current.lastIndexOf("/") + 1));
  }

  protected enter(folder: Folder) {
    const listing = this.listing();
    if (listing) void this.load(childPath(listing.path, folder.name));
  }

  protected select(index: number) {
    this.active.set(index);
    this.list().nativeElement.focus();
  }

  protected toggleHidden(show: boolean) {
    const selected = this.folders()[this.active()]?.name;
    this.showHidden.set(show);
    remember(SHOW_HIDDEN, String(show));
    this.active.set(selected === undefined ? -1 : this.folders().findIndex((folder) => folder.name === selected));
  }

  protected key(event: KeyboardEvent) {
    if (event.key === "Backspace" || (event.key === "ArrowUp" && event.altKey)) {
      event.preventDefault();
      this.up();
      return;
    }
    const folders = this.folders();
    const move = (index: number) => {
      event.preventDefault();
      if (folders.length) this.active.set(Math.max(0, Math.min(folders.length - 1, index)));
    };
    if (event.key === "ArrowDown") move(this.active() + 1);
    else if (event.key === "ArrowUp") move(this.active() - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(folders.length - 1);
    else if (event.key === "Enter") {
      event.preventDefault();
      const folder = folders[this.active()];
      if (folder) this.enter(folder);
    } else if (event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey) this.typeAhead(event.key);
  }

  /** Selects the next folder whose name starts with the keys typed in quick succession. */
  private typeAhead(key: string) {
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => (this.search = ""), TYPE_AHEAD);
    this.search += key.toLowerCase();
    const folders = this.folders();
    // A first key moves on to the next match; further keys refine the current one.
    const start = this.search.length === 1 ? this.active() + 1 : Math.max(0, this.active());
    for (let offset = 0; offset < folders.length; offset++) {
      const index = (start + offset) % folders.length;
      if (folders[index]!.name.toLowerCase().startsWith(this.search)) {
        this.active.set(index);
        return;
      }
    }
  }

  protected chooseCurrent() {
    const listing = this.listing();
    if (listing) this.dialog.close({ path: listing.path, open: false });
  }

  protected submit() {
    const repository = this.repository();
    const listing = this.listing();
    if (repository && listing) this.dialog.close({ path: childPath(listing.path, repository.name), open: true });
    else this.chooseCurrent();
  }
}
