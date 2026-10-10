import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from "@angular/core";
import type { ConflictFile, ConflictKind, ConflictResolution } from "../../../../contracts/model";
import { type ConflictHunk, type HunkChoice, parseConflicts, resolveHunk } from "../../../../utilities/conflict-markers";
import { Dialogs } from "../../core/dialogs";
import { messageOf } from "../../core/notifications";
import { Session } from "../../core/session";
import { trackUnsaved } from "../../core/unsaved-changes";
import { WorkspaceApi } from "../../core/workspace-api";
import { CodeEditor, type LineRange } from "../../editor/code-editor";
import { EmptyState } from "../../ui/empty-state";
import { Icon } from "../../ui/icon";

interface Choice {
  readonly label: string;
  readonly resolution: ConflictResolution;
  readonly primary?: boolean;
}

const KINDS: Readonly<Record<ConflictKind, { readonly summary: string; readonly choices: readonly Choice[] }>> = {
  "both-modified": {
    summary: "Both sides changed this file.",
    choices: [
      { label: "Take current", resolution: { use: "ours" } },
      { label: "Take incoming", resolution: { use: "theirs" } },
    ],
  },
  "both-added": {
    summary: "Both sides added this file.",
    choices: [
      { label: "Take current", resolution: { use: "ours" } },
      { label: "Take incoming", resolution: { use: "theirs" } },
    ],
  },
  "deleted-by-them": {
    summary: "The current side changed this file; the incoming side deleted it.",
    choices: [
      { label: "Keep the file", resolution: { use: "ours" }, primary: true },
      { label: "Delete the file", resolution: { use: "delete" } },
    ],
  },
  "deleted-by-us": {
    summary: "The current side deleted this file; the incoming side changed it.",
    choices: [
      { label: "Keep the incoming file", resolution: { use: "theirs" }, primary: true },
      { label: "Delete the file", resolution: { use: "delete" } },
    ],
  },
  "added-by-us": {
    summary: "Only the current side has this file.",
    choices: [
      { label: "Keep the file", resolution: { use: "ours" }, primary: true },
      { label: "Delete the file", resolution: { use: "delete" } },
    ],
  },
  "added-by-them": {
    summary: "Only the incoming side has this file.",
    choices: [
      { label: "Keep the file", resolution: { use: "theirs" }, primary: true },
      { label: "Delete the file", resolution: { use: "delete" } },
    ],
  },
  "both-deleted": {
    summary: "Both sides deleted or renamed this file.",
    choices: [{ label: "Delete the file", resolution: { use: "delete" }, primary: true }],
  },
};

/** The line range of a hunk, markers included. */
const rangeOf = (hunk: ConflictHunk): LineRange => ({ from: hunk.line, to: hunk.line + hunk.lines - 1 });

/**
 * Resolves a conflicted file: hunk by hunk ("Accept current / incoming /
 * both") or by editing the result, or as a whole; "Mark as resolved" stages
 * it. Binary files and files deleted on one side offer whole-file choices.
 */
@Component({
  selector: "gd-conflict-pane",
  imports: [CodeEditor, EmptyState, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: "./conflict-pane.css",
  host: { class: "view" },
  template: `
    <header class="view-header">
      <div class="view-title mono ellipsis">{{ path() }}</div>
      <span class="conflict-badge">Conflict</span>
      <span class="grow"></span>
      @if (editable()) {
        @for (choice of kind().choices; track choice.label) {
          <button type="button" class="btn btn-ghost btn-s" [disabled]="session.busy()" (click)="resolve(choice.resolution)">
            <span>{{ choice.label }}</span>
          </button>
        }
        <button type="button" class="btn btn-primary btn-s" [disabled]="session.busy()" (click)="markResolved()">
          <span>Mark as resolved</span>
        </button>
      }
    </header>
    @if (error(); as message) {
      <gd-empty-state title="Can't read this conflict"
        ><p class="selectable">{{ message }}</p></gd-empty-state
      >
    } @else if (!file()) {
      <div class="editor-loading"><span class="spinner" aria-label="Loading"></span></div>
    } @else if (!editable()) {
      <gd-empty-state [title]="kind().summary">
        <p>{{ bothSides() ? "GitDesk can't merge this file line by line. Choose a side." : "Choose what to keep." }}</p>
        <div class="conflict-choices">
          @for (choice of kind().choices; track choice.label) {
            <button
              type="button"
              class="btn btn-m"
              [class.btn-primary]="choice.primary"
              [class.btn-default]="!choice.primary"
              [disabled]="session.busy()"
              (click)="resolve(choice.resolution)"
            >
              <span>{{ choice.label }}</span>
            </button>
          }
        </div>
      </gd-empty-state>
    } @else {
      <div class="conflict-bar" role="toolbar" aria-label="Conflicts">
        @if (active(); as hunk) {
          <span class="conflict-count">Conflict {{ index() + 1 }} of {{ hunks().length }}</span>
          <button type="button" class="icon-btn" aria-label="Previous conflict" title="Previous conflict" (click)="go(-1)">
            <svg gd-icon name="chevron-up" [size]="14"></svg>
          </button>
          <button type="button" class="icon-btn" aria-label="Next conflict" title="Next conflict" (click)="go(1)">
            <svg gd-icon name="chevron-down" [size]="14"></svg>
          </button>
          <span class="grow"></span>
          <button type="button" class="btn btn-default btn-s" [title]="hunk.oursLabel" (click)="accept('ours')">
            <span>Accept current</span>
          </button>
          <button type="button" class="btn btn-default btn-s" [title]="hunk.theirsLabel" (click)="accept('theirs')">
            <span>Accept incoming</span>
          </button>
          <button type="button" class="btn btn-default btn-s" (click)="accept('both')"><span>Accept both</span></button>
        } @else {
          <span class="conflict-count">No conflict markers left. Check the result, then mark the file as resolved.</span>
        }
      </div>
      <gd-code-editor
        [value]="text()"
        [path]="path()"
        [reveal]="reveal()"
        [label]="'Resolution of ' + path()"
        (valueChange)="text.set($event)"
      />
    }
  `,
})
export class ConflictPane {
  readonly path = input.required<string>();

  protected readonly session = inject(Session);
  private readonly api = inject(WorkspaceApi);
  private readonly dialogs = inject(Dialogs);
  protected readonly file = signal<ConflictFile | null>(null);
  protected readonly error = signal<string | null>(null);
  /** The result being edited, and the text it started from. */
  protected readonly text = signal("");
  private readonly saved = signal("");
  protected readonly hunks = computed(() => parseConflicts(this.text()));
  protected readonly index = signal(0);
  protected readonly active = computed(() => this.hunks()[Math.min(this.index(), this.hunks().length - 1)] ?? null);
  /** Set by the conflict buttons, not by typing, so editing never moves the selection. */
  protected readonly reveal = signal<LineRange | null>(null);
  protected readonly kind = computed(() => KINDS[this.file()?.kind ?? "both-modified"]);
  /** Both sides have the file; it can be merged line by line unless it is binary. */
  protected readonly bothSides = computed(() => this.file()?.kind === "both-modified" || this.file()?.kind === "both-added");
  protected readonly editable = computed(() => this.bothSides() && this.file()?.text !== null);

  constructor() {
    trackUnsaved(computed(() => this.text() !== this.saved()));
    effect(() => {
      const path = this.path();
      untracked(() => void this.load(path));
    });
  }

  private async load(path: string) {
    try {
      const file = await this.api.versionControl.conflict(path);
      this.file.set(file);
      this.text.set(file.text ?? "");
      this.saved.set(file.text ?? "");
      this.show(0);
    } catch (failure) {
      this.error.set(messageOf(failure));
    }
  }

  protected go(step: number) {
    const count = this.hunks().length;
    if (count) this.show((Math.min(this.index(), count - 1) + step + count) % count);
  }

  protected accept(choice: HunkChoice) {
    const hunk = this.active();
    if (!hunk) return;
    this.text.set(resolveHunk(this.text(), hunk, choice));
    // The next conflict moves up into this one's place.
    this.show(Math.min(this.index(), this.hunks().length - 1));
  }

  private show(index: number) {
    this.index.set(Math.max(0, index));
    const hunk = this.hunks()[this.index()];
    if (hunk) this.reveal.set(rangeOf(hunk));
  }

  protected async markResolved() {
    const text = this.text();
    if (this.hunks().length) {
      const confirmed = await this.dialogs.confirm({
        title: "Conflict markers left",
        message: `${this.path()} still has ${this.hunks().length} conflict(s) marked in it. Mark it as resolved anyway?`,
        confirm: "Mark as resolved",
      });
      if (!confirmed) return;
    }
    await this.resolve({ use: "text", text });
  }

  protected async resolve(resolution: ConflictResolution) {
    await this.session.succeeded(async () => {
      await this.api.versionControl.resolveConflict(this.path(), resolution);
      // Clean before the refresh, which moves on to the next file.
      this.saved.set(this.text());
    }, `Resolved ${this.path()}`);
  }
}
