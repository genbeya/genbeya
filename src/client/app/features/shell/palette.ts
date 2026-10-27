import { DIALOG_DATA, DialogRef } from "@angular/cdk/dialog";
import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  type ElementRef,
  inject,
  signal,
  untracked,
  viewChild,
} from "@angular/core";
import { Router } from "@angular/router";
import type { SearchOptions } from "../../../../contracts/model";
import { CTRL_KEY, isMac, MOD_KEY, SHIFT_KEY } from "../../core/hotkeys";
import { Repositories } from "../../core/repositories";
import { People } from "../../core/people";
import { Session } from "../../core/session";
import { Terminals } from "../../core/terminals";
import { PullActions } from "../pulls/pull-actions";
import { ContentFiles } from "../code/content-files";
import { ResetActions } from "../history/reset-actions";
import { Onboarding } from "../onboarding/onboarding";
import { PushActions } from "../push/push-actions";
import { WikiActions } from "../wiki/wiki-actions";
import { MarkedText } from "./marked-text";
import { PaletteIcon } from "./palette-icon";
import { OperationActions } from "../operations/operation-actions";
import { allItems, branchItems, linkItem, mentionItems, mergeItems, rank, rebaseItems, type PaletteCommands } from "./palette-items";
import { RepositoryActions } from "./repository-actions";
import { describeResults, SEARCH_PREFIX, searchItems, searchText, type PaletteRow, type SearchCommands } from "./search-items";
import { ShellUi, type PaletteMode } from "./shell-ui";
import { ViewMemory } from "./view-memory";
import { textSearch } from "./text-search";

/**
 * Search options, toggled with Alt and their letter; on macOS with ⌥⌘, since
 * Option and a letter types a character there (⌥C is ç), as in the editor's find.
 */
const TOGGLES: readonly { key: keyof SearchOptions; text: string; label: string; code: string }[] = [
  { key: "caseSensitive", text: "Aa", label: "Match case", code: "KeyC" },
  { key: "wholeWord", text: "ab", label: "Whole word", code: "KeyW" },
  { key: "regex", text: ".*", label: "Regular expression", code: "KeyR" },
];

/** The search option `event` toggles, if any. */
export function toggledOption(event: KeyboardEvent, mac = isMac): keyof SearchOptions | undefined {
  if (!event.altKey || event.ctrlKey || event.metaKey !== mac) return undefined;
  return TOGGLES.find((option) => option.code === event.code)?.key;
}

/** How the shortcut of the option with `code` reads on this platform. */
const toggleKeys = (code: string) => (isMac ? "⌥⌘" : "Alt+") + code.slice(3);

/** Search and commands (Ctrl+K), full-text search ("/" or Ctrl+Shift+F), or the branch switcher. */
@Component({
  selector: "gd-palette",
  imports: [MarkedText, PaletteIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: "./palette.css",
  template: `
    <div class="palette" role="dialog" [attr.aria-label]="label">
      <div class="palette-field">
        <input
          #field
          class="palette-input"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-results"
          [attr.aria-label]="placeholder()"
          [attr.aria-activedescendant]="results()[active()] ? 'palette-' + active() : null"
          spellcheck="false"
          [placeholder]="placeholder()"
          [value]="query()"
          (input)="search(field.value)"
          (keydown)="key($event)"
        />
        @if (fullText() !== null) {
          <div class="palette-toggles" role="group" aria-label="Search options">
            @for (toggle of toggles; track toggle.key) {
              <button
                type="button"
                class="palette-toggle"
                [attr.aria-pressed]="text.options()[toggle.key]"
                [attr.aria-label]="toggle.label"
                [title]="toggle.label + ' (' + toggleKeys(toggle.code) + ')'"
                (click)="flip(toggle.key)"
              >
                {{ toggle.text }}
              </button>
            }
          </div>
        }
      </div>
      <div class="palette-list" id="palette-results" role="listbox" #list>
        @for (item of results(); track item.id; let index = $index) {
          @if (index === 0 || results()[index - 1]!.group !== item.group) {
            <div class="palette-group" role="presentation">{{ item.group }}</div>
          }
          @if (item.match; as match) {
            @if (index === 0 || results()[index - 1]!.group !== item.group || results()[index - 1]!.match?.file !== match.file) {
              <div class="palette-file" role="presentation">
                <span class="palette-icon"><gd-palette-icon [icon]="item.icon" /></span>
                <span class="ellipsis">{{ match.file }}</span>
                <span class="palette-detail ellipsis">{{ match.fileDetail }}</span>
              </div>
            }
          }
          <button
            type="button"
            role="option"
            tabindex="-1"
            class="palette-item"
            [class.is-match]="!!item.match"
            [id]="'palette-' + index"
            [class.is-active]="index === active()"
            [attr.aria-selected]="index === active()"
            [attr.aria-label]="item.match ? item.label : null"
            (mousemove)="active.set(index)"
            (click)="choose(item)"
          >
            @if (item.match; as match) {
              <span class="palette-line">{{ match.line }}</span>
              <gd-marked-text [segments]="match.segments" />
            } @else {
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
            }
          </button>
        } @empty {
          <div class="palette-empty">{{ empty() }}</div>
        }
      </div>
      @if (fullText() !== null) {
        @if (results()[active()]?.match; as match) {
          <div class="palette-preview" aria-hidden="true">
            @if (match.before !== null) {
              <div class="palette-context">
                <span class="palette-line">{{ match.line - 1 }}</span>
                <span class="ellipsis">{{ match.before }}</span>
              </div>
            }
            <div class="palette-context is-match">
              <span class="palette-line">{{ match.line }}</span>
              <gd-marked-text [segments]="match.segments" />
            </div>
            @if (match.after !== null) {
              <div class="palette-context">
                <span class="palette-line">{{ match.line + 1 }}</span>
                <span class="ellipsis">{{ match.after }}</span>
              </div>
            }
          </div>
        }
        <div class="palette-status" role="status">{{ status() }}</div>
      }
    </div>
  `,
})
export class Palette {
  protected readonly mode = inject<PaletteMode>(DIALOG_DATA);
  private readonly dialog = inject(DialogRef);
  private readonly session = inject(Session);
  private readonly router = inject(Router);
  private readonly views = inject(ViewMemory);
  private readonly wiki = inject(WikiActions);
  private readonly repository = inject(RepositoryActions);
  private readonly operations = inject(OperationActions);
  private readonly pushes = inject(PushActions);
  private readonly resets = inject(ResetActions);
  private readonly ui = inject(ShellUi);
  private readonly terminals = inject(Terminals);
  private readonly onboarding = inject(Onboarding);
  private readonly people = inject(People);
  private readonly contentFiles = inject(ContentFiles);
  private readonly pulls = inject(PullActions);
  protected readonly label =
    this.mode === "branches"
      ? "Switch branch"
      : this.mode === "merge"
        ? "Merge branch"
        : this.mode === "rebase"
          ? "Rebase onto"
          : "Command palette";
  protected readonly query = signal(this.ui.takeQuery() ?? (this.mode === "search" ? SEARCH_PREFIX : ""));
  protected readonly active = signal(0);
  private readonly recent = inject(Repositories).recent;
  private readonly list = viewChild.required<ElementRef<HTMLElement>>("list");
  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>("field");
  protected readonly toggles = TOGGLES;

  private readonly commands: PaletteCommands = {
    go: (view) => void this.views.open(view),
    openPage: (path) => void this.wiki.openPage(path),
    openTask: (task) => void this.router.navigate(["/tasks"], { queryParams: { task } }),
    openFile: (file) => void this.router.navigate(["/code"], { queryParams: { file } }),
    newPage: () => void this.wiki.createPage(),
    newTask: () => void this.router.navigate(["/tasks"], { queryParams: { create: this.session.snapshot()!.settings.statuses[0] } }),
    newPull: () => void this.pulls.create(),
    switchBranch: (name) => void this.repository.switchBranch(name),
    createBranch: (name) => void this.repository.createBranch(name),
    showBranches: () => void this.ui.openPalette("branches"),
    merge: (source, kind) => void this.operations.merge(source, kind),
    showMerge: () => void this.ui.openPalette("merge"),
    rebase: (onto) => void this.operations.rebase(onto),
    showRebase: () => void this.ui.openPalette("rebase"),
    pullRebase: (remote) => void this.operations.pullRebase(remote),
    searchText: () => void this.ui.openPalette("search"),
    findMentions: (handle) => void this.ui.openPalette("search", `${SEARCH_PREFIX}@${handle}`),
    sync: (action, remote) => void this.repository.sync(action, remote),
    push: () => void this.pushes.push(),
    pushTo: () => void this.pushes.pushTo(),
    undoLastCommit: () => void this.resets.undoLastCommit(),
    syncContent: () => void this.repository.syncContent(),
    pickFolder: () => void this.session.pick(),
    openRemote: () => void this.ui.openRemote(),
    openClone: () => void this.ui.openClone(),
    closeRepository: () => void this.session.close(),
    openRecent: (entry) => void this.session.open(entry.location),
    setTheme: (theme) => void this.session.setPreferences({ theme }),
    toggleMinimap: () => void this.session.setPreferences({ minimap: !this.session.preferences().minimap }),
    showHelp: () => void this.ui.showHelp(),
    toggleTerminal: () => void this.terminals.toggle(),
    openLink: (link) => void this.ui.openLink(link),
    startTour: () => void this.onboarding.startTour(),
    showWhatsNew: () => void this.onboarding.showWhatsNew(),
    openDocs: () => void this.onboarding.openDocs(),
  };

  /** Pages scroll to the heading above the line, code selects it; the code view cannot show files on the content branch. */
  private readonly found: SearchCommands = {
    openPage: (page, line) => void this.router.navigate(["/wiki"], { queryParams: { page, line } }),
    openTask: (task) => this.commands.openTask(task),
    openFile: (file, line, scope) =>
      void (scope === "content"
        ? this.contentFiles.explain(file, file.split("/").at(-1)!)
        : this.router.navigate(["/code"], { queryParams: { file, lines: line } })),
  };

  /** The text after "/", which searches inside files; null for the other modes. */
  protected readonly fullText = computed(() => (this.mode === "all" || this.mode === "search" ? searchText(this.query()) : null));
  protected readonly text = textSearch(this.fullText);

  private readonly items = computed(() => {
    const snapshot = this.session.snapshot()!;
    if (this.mode === "branches") return branchItems(snapshot, this.query(), this.commands);
    if (this.mode === "merge") return mergeItems(snapshot, this.commands);
    if (this.mode === "rebase") return rebaseItems(snapshot, this.commands);
    return [
      ...allItems(
        snapshot,
        this.recent(),
        this.session.preferences().theme,
        { mod: MOD_KEY, ctrl: CTRL_KEY, shift: SHIFT_KEY },
        this.commands,
      ),
      ...mentionItems(this.people.me(), this.commands),
    ];
  });
  protected readonly results = computed<readonly PaletteRow[]>(() => {
    if (this.fullText() !== null) {
      const found = this.text.results();
      return found ? searchItems(found, this.found) : [];
    }
    const link = this.mode === "all" ? linkItem(this.query(), this.commands) : null;
    return link ? [link] : rank(this.items(), this.query(), this.mode !== "all");
  });

  protected readonly placeholder = computed(() => {
    const branch = this.session.snapshot()?.head.branch ?? "the current branch";
    if (this.mode === "branches") return "Switch to branch…";
    if (this.mode === "merge") return `Merge into ${branch}…`;
    if (this.mode === "rebase") return `Rebase ${branch} onto…`;
    return this.fullText() !== null ? "Search in pages, tasks and files…" : "Search pages, tasks, files and commands…";
  });
  protected readonly toggleKeys = toggleKeys;
  protected readonly status = computed(() => {
    if (!this.fullText()?.trim())
      return `${toggleKeys("KeyC")} match case · ${toggleKeys("KeyW")} whole word · ${toggleKeys("KeyR")} regular expression`;
    if (this.text.loading()) return "Searching…";
    const results = this.text.results();
    return this.text.error() ?? (results ? describeResults(results) : "");
  });
  protected readonly empty = computed(() => {
    if (this.fullText() === null) return "No matches";
    if (!this.fullText()!.trim()) return "Type to search inside pages, tasks and files.";
    return this.text.loading() ? "Searching…" : (this.text.error() ?? "No matches");
  });

  constructor() {
    afterRenderEffect(() => {
      this.active();
      this.list().nativeElement.querySelector(".palette-item.is-active")?.scrollIntoView({ block: "nearest" });
    });
    afterRenderEffect(() => this.field().nativeElement.focus());
    // New search results start at the top.
    effect(() => {
      this.text.results();
      untracked(() => this.active.set(0));
    });
  }

  protected search(value: string) {
    this.query.set(value);
    this.active.set(0);
  }

  protected flip(option: keyof SearchOptions) {
    this.text.options.update((options) => ({ ...options, [option]: !options[option] }));
    this.field().nativeElement.focus();
  }

  protected key(event: KeyboardEvent) {
    const count = Math.max(1, this.results().length);
    const toggle = toggledOption(event);
    if (toggle && this.fullText() !== null) {
      event.preventDefault();
      this.flip(toggle);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      this.active.update((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + count) % count);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = this.results()[this.active()];
      if (item) this.choose(item);
    }
  }

  protected choose(item: PaletteRow) {
    this.dialog.close();
    item.run();
  }
}
