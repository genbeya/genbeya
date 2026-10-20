import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked, viewChild } from "@angular/core";
import type { Diff, DiffImages, LineSelection } from "../../../../contracts/model";
import { messageOf } from "../../core/notifications";
import { Session } from "../../core/session";
import { DiffView, type DiffLines, type HunkAction, type HunkEvent } from "../../editor/diff-view";
import { EmptyState } from "../../ui/empty-state";
import { Icon } from "../../ui/icon";
import type { IconName } from "../../ui/icon-data";
import { Remembered } from "../../ui/remembered";
import { comparisonOf, type Comparison } from "../preview/file-previews";
import { formatBytes } from "../preview/file-size";
import { ImageComparison, type ImageComparisonMode } from "../preview/image-comparison";

const INLINE_KEY = "diff:inline";
const IMAGE_MODE_KEY = "diff:images";

const IMAGE_MODES: readonly { readonly mode: ImageComparisonMode; readonly label: string; readonly icon: IconName }[] = [
  { mode: "sides", label: "Side by side", icon: "columns-2" },
  { mode: "swipe", label: "Swipe", icon: "move-horizontal" },
];

/** Something to do with parts of a diff: "Stage" becomes "Stage hunk" and "Stage selected lines". */
export interface DiffAction {
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
  readonly danger?: boolean;
}

/** How an action on lines went: a cancelled one keeps the selection, a failed one shows the diff as it is now. */
export type DiffActionOutcome = "done" | "failed" | "cancelled";

/** Runs an action on lines chosen in the version `version` of the diff. */
export type DiffActionHandler = (action: string, lines: LineSelection, version: string, hunk: boolean) => Promise<DiffActionOutcome>;

const lineCount = (selection: LineSelection) =>
  [...selection.original, ...selection.modified].reduce((total, range) => total + range.to - range.from + 1, 0);

/**
 * A file's diff with a header; reloads whenever the repository changes, and
 * after its actions. Project actions into the header. With `actions`, each
 * changed chunk offers them, and a toolbar offers them for selected lines.
 */
@Component({
  selector: "gd-diff-pane",
  imports: [DiffView, EmptyState, Icon, ImageComparison],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: "./diff-pane.css",
  // Changes made in another app show once the window is back.
  host: { class: "view", "(window:focus)": "reload()" },
  template: `
    <header class="view-header">
      <div class="view-title mono diff-path ellipsis">{{ path() }}</div>
      @if (badge()) {
        <span class="diff-badge">{{ badge() }}</span>
      }
      <span class="grow"></span>
      <ng-content />
      @if (comparison() === "image") {
        <div class="segmented diff-modes" role="radiogroup" aria-label="Compare">
          @for (choice of imageModes; track choice.mode) {
            <button
              type="button"
              role="radio"
              [attr.aria-checked]="imageMode() === choice.mode"
              [class.is-active]="imageMode() === choice.mode"
              [disabled]="choice.mode === 'swipe' && !swipes()"
              [title]="choice.mode === 'swipe' && !swipes() ? 'Swiping needs both versions' : ''"
              (click)="setImageMode(choice.mode)"
            >
              <svg gd-icon [name]="choice.icon" [size]="12"></svg> {{ choice.label }}
            </button>
          }
        </div>
      } @else {
        <button
          type="button"
          class="icon-btn"
          [attr.aria-label]="inline() ? 'Side by side' : 'Inline'"
          [title]="inline() ? 'Side by side' : 'Inline'"
          (click)="toggleInline()"
        >
          @if (inline()) {
            <svg gd-icon name="columns-2" [size]="15"></svg>
          } @else {
            <svg gd-icon name="rows-2" [size]="15"></svg>
          }
        </button>
      }
    </header>
    @if (error(); as message) {
      <gd-empty-state title="Can't show this diff"
        ><p class="selectable">{{ message }}</p></gd-empty-state
      >
    } @else if (!diff()) {
      <div class="editor-loading"><span class="spinner" aria-label="Loading"></span></div>
    } @else if (comparison() === "image") {
      @if (images(); as pair) {
        <gd-image-comparison
          [original]="pair.original"
          [modified]="pair.modified"
          [mode]="imageMode()"
          [name]="path().split('/').at(-1)!"
        />
      } @else {
        <div class="editor-loading"><span class="spinner" aria-label="Loading"></span></div>
      }
    } @else if (comparison() === "binary") {
      @if (diff()!.sizes; as sizes) {
        <gd-empty-state title="Binary file">
          <p>Genbeya does not show differences for binary files.</p>
          <p class="diff-sizes">{{ sizeChange(sizes) }}</p>
        </gd-empty-state>
      } @else {
        <gd-empty-state title="File too large"><p>Genbeya does not compare files this large line by line.</p></gd-empty-state>
      }
    } @else {
      @if (actions().length && !diff()!.changes) {
        <div class="diff-toolbar">
          <span class="diff-toolbar-text">Genbeya can only stage this file as a whole.</span>
        </div>
      } @else if (actions().length) {
        <div class="diff-toolbar" role="toolbar" aria-label="Selected lines">
          @if (selection(); as selected) {
            <span class="diff-toolbar-text">{{ count() }} {{ count() === 1 ? "line" : "lines" }} selected</span>
            @for (action of actions(); track action.id) {
              <button
                type="button"
                class="btn btn-s"
                [class.is-danger]="action.danger"
                [disabled]="running()"
                (click)="run(action.id, selected)"
              >
                <svg gd-icon [name]="action.icon" [size]="13"></svg>{{ action.label }} selected lines
              </button>
            }
          } @else {
            <span class="diff-toolbar-text">Select lines by their numbers, or use the bar above a change.</span>
          }
        </div>
      }
      <gd-diff-view
        [path]="path()"
        [diff]="diff()!"
        [inline]="inline()"
        [hunkActions]="diff()!.changes ? hunkActions() : []"
        (hunk)="onHunk($event)"
        (lines)="selection.set($event)"
      />
    }
  `,
})
export class DiffPane {
  readonly path = input.required<string>();
  /** Fetches the diff; called again on every repository change. */
  readonly load = input.required<() => Promise<Diff>>();
  readonly badge = input<string>();
  readonly actions = input<readonly DiffAction[]>([]);
  readonly apply = input<DiffActionHandler>(async () => "done");
  /** Fetches both versions of an image with the arguments of `load`; without it, images show as binary files. */
  readonly loadImages = input<(() => Promise<DiffImages>) | null>(null);

  private readonly session = inject(Session);
  private readonly memory = inject(Remembered);
  private readonly view = viewChild(DiffView);
  protected readonly diff = signal<Diff | null>(null);
  protected readonly images = signal<DiffImages | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly inline = signal(this.memory.recall(INLINE_KEY) === "1");
  protected readonly imageModes = IMAGE_MODES;
  private readonly chosenImageMode = signal<ImageComparisonMode>(this.memory.recall(IMAGE_MODE_KEY) === "swipe" ? "swipe" : "sides");
  /** Swiping needs both versions: an added or deleted image is shown side by side. */
  protected readonly swipes = computed(() => !!this.images()?.original && !!this.images()?.modified);
  protected readonly imageMode = computed<ImageComparisonMode>(() => (this.swipes() ? this.chosenImageMode() : "sides"));
  /** How the file is compared, as the preview registry says. */
  protected readonly comparison = computed<Comparison | null>(() => {
    const diff = this.diff();
    if (!diff) return null;
    const comparison = comparisonOf(this.path(), diff.binary);
    return comparison === "image" && !this.loadImages() ? "binary" : comparison;
  });
  protected readonly selection = signal<DiffLines | null>(null);
  protected readonly running = signal(false);
  protected readonly count = computed(() => {
    const selection = this.selection();
    return selection ? lineCount(selection.lines) : 0;
  });
  protected readonly hunkActions = computed<HunkAction[]>(() =>
    this.actions().map((action) => ({ id: action.id, label: `${action.label} hunk`, danger: action.danger })),
  );
  private request = 0;

  constructor() {
    effect(() => {
      const load = this.load();
      // Any repository change may change the diff.
      this.session.snapshot();
      untracked(() => void this.fetch(load));
    });
  }

  private async fetch(load: () => Promise<Diff>) {
    const ticket = ++this.request;
    try {
      const diff = await load();
      if (ticket !== this.request) return;
      // An unchanged diff keeps its view, so scrolling is not reset on every poll.
      const current = this.diff();
      const changed =
        !current ||
        current.version !== diff.version ||
        current.original !== diff.original ||
        current.modified !== diff.modified ||
        current.binary !== diff.binary ||
        !current.changes !== !diff.changes;
      const loadImages = untracked(this.loadImages);
      // Images are read again when the diff changed; without a version (too large to compare) always.
      if (loadImages && comparisonOf(untracked(this.path), diff.binary) === "image" && (changed || !diff.version || !this.images())) {
        const images = await loadImages();
        if (ticket !== this.request) return;
        this.images.set(images);
      }
      if (changed) this.diff.set(diff);
      this.error.set(null);
    } catch (failure) {
      if (ticket === this.request) this.error.set(messageOf(failure));
    }
  }

  protected setImageMode(mode: ImageComparisonMode) {
    this.chosenImageMode.set(mode);
    this.memory.remember(IMAGE_MODE_KEY, mode);
  }

  /** The sizes of a binary file's two versions: "12 KB → 14 KB". */
  protected sizeChange([before, after]: readonly [number, number]): string {
    return `${before ? formatBytes(before) : "None"} → ${after ? formatBytes(after) : "none"}`;
  }

  protected toggleInline() {
    this.inline.update((inline) => !inline);
    this.memory.remember(INLINE_KEY, this.inline() ? "1" : "0");
  }

  protected onHunk(event: HunkEvent) {
    void this.run(event.action, event, true);
  }

  /** Shows the diff as it is now. */
  protected reload(): Promise<void> {
    return this.fetch(this.load());
  }

  /**
   * Runs an action on lines of the diff shown, then shows the diff as it is
   * now: the snapshot may not change when a file was partly staged already,
   * and a file changed outside the app changes no snapshot either.
   */
  protected async run(action: string, { lines, version }: DiffLines, hunk = false) {
    if (this.running()) return;
    this.running.set(true);
    let outcome: DiffActionOutcome;
    try {
      outcome = await this.apply()(action, lines, version, hunk);
    } finally {
      this.running.set(false);
    }
    if (outcome === "cancelled") return;
    if (outcome === "done") this.view()?.clearSelection();
    await this.reload();
  }
}
