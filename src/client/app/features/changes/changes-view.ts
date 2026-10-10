import { ChangeDetectionStrategy, Component, computed, effect, inject, input, untracked } from "@angular/core";
import { Router } from "@angular/router";
import { LucideArchive, LucideCheckCheck, LucideMinus, LucidePlus, LucideUndo2 } from "@lucide/angular";
import type { Change } from "../../../../contracts/model";
import { Dialogs } from "../../core/dialogs";
import { hotkey, MOD_KEY } from "../../core/hotkeys";
import { Session } from "../../core/session";
import { WorkspaceApi } from "../../core/workspace-api";
import { EmptyState } from "../../ui/empty-state";
import { Resizable, ResizeHandle } from "../../ui/resizable";
import { DiffPane } from "../diff/diff-pane";
import { relativeTime } from "../history/commit-graph";
import { ChangeRow } from "./change-row";
import { CommitDraft } from "./commit-draft";
import { StashActions } from "./stash-actions";
import { StashPane } from "./stash-pane";
import { SyncBar } from "./sync-bar";

const isStaged = (change: Change) => change.index !== " " && change.index !== "?";
const isUnstaged = (change: Change) => change.worktree !== " ";

/** Staging, committing and stashes, with the selected change's diff (`?file=&staged=`) or stash (`?stash=&file=`). */
@Component({
  selector: "gd-changes-view",
  imports: [
    ChangeRow,
    DiffPane,
    EmptyState,
    Resizable,
    ResizeHandle,
    StashPane,
    SyncBar,
    LucideArchive,
    LucideCheckCheck,
    LucideMinus,
    LucidePlus,
    LucideUndo2,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: "./changes.css",
  host: { class: "view" },
  templateUrl: "./changes-view.html",
})
export class ChangesView {
  readonly file = input<string>();
  /** Query parameters are strings: "true" selects the staged version. */
  readonly staged = input<string>();
  readonly stash = input<string>();

  private readonly session = inject(Session);
  private readonly api = inject(WorkspaceApi);
  private readonly dialogs = inject(Dialogs);
  private readonly router = inject(Router);
  protected readonly stashes = inject(StashActions);
  protected readonly mod = MOD_KEY;
  protected readonly relativeTime = relativeTime;
  private readonly draft = inject(CommitDraft);
  protected readonly message = this.draft.message;
  protected readonly amend = this.draft.amend;

  protected readonly snapshot = computed(() => this.session.snapshot()!);
  protected readonly stagedChanges = computed(() => this.snapshot().changes.filter(isStaged));
  protected readonly unstagedChanges = computed(() => this.snapshot().changes.filter(isUnstaged));
  protected readonly showsStaged = computed(() => this.staged() === "true");
  protected readonly current = computed(() => this.snapshot().changes.find((change) => change.path === this.file()));
  protected readonly selectedStash = computed(() => this.snapshot().stashes.find((entry) => entry.hash === this.stash()));
  /** Without staged changes, a commit takes everything. */
  protected readonly commitsAll = computed(() => !this.stagedChanges().length && !this.amend());
  protected readonly canCommit = computed(
    () => !!this.message().trim() && (this.amend() || this.snapshot().changes.length > 0) && !this.session.busy(),
  );
  protected readonly commitLabel = computed(() =>
    this.amend()
      ? "Amend"
      : this.commitsAll()
        ? `Commit all ${this.snapshot().changes.length || ""}`.trim()
        : `Commit ${this.stagedChanges().length}`,
  );
  protected readonly badge = computed(() => (this.showsStaged() ? "Staged" : this.current()?.index === "?" ? "Untracked" : "Working tree"));
  protected readonly loadDiff = computed(() => {
    const file = this.file();
    const staged = this.showsStaged();
    const oldPath = staged ? this.current()?.oldPath : undefined;
    return () => this.api.versionControl.diff(file!, staged ? "index" : "worktree", oldPath);
  });

  constructor() {
    // Keep a valid selection: fall back to the first change.
    effect(() => {
      if (this.selectedStash()) return;
      const list = this.showsStaged() ? this.stagedChanges() : this.unstagedChanges();
      const file = this.file();
      if (file && list.some((change) => change.path === file)) return;
      const first = this.unstagedChanges()[0] ?? this.stagedChanges()[0];
      untracked(() => {
        if (first) this.select(first.path, !this.unstagedChanges()[0]);
        else if (file) void this.router.navigate(["/changes"], { replaceUrl: true });
      });
    });
    hotkey("mod+enter", () => void this.commit());
  }

  protected select(path: string, staged: boolean) {
    void this.router.navigate(["/changes"], { queryParams: { file: path, staged: staged ? "true" : null }, replaceUrl: true });
  }

  protected selectStash(hash: string) {
    void this.router.navigate(["/changes"], { queryParams: { stash: hash }, replaceUrl: true });
  }

  protected openFile(path: string) {
    void this.router.navigate(["/code"], { queryParams: { file: path } });
  }

  protected isSelected(change: Change, staged: boolean): boolean {
    return this.file() === change.path && this.showsStaged() === staged;
  }

  protected async commit() {
    if (!this.canCommit()) return;
    const all = this.commitsAll();
    const done = await this.session.run(
      async () => {
        if (all) await this.api.versionControl.stage(this.snapshot().changes.map((change) => change.path));
        await this.api.versionControl.commit(this.message(), this.amend());
        return true;
      },
      this.amend() ? "Commit amended" : "Committed",
    );
    if (done) this.draft.clear();
  }

  protected async toggleAmend(amend: boolean) {
    this.amend.set(amend);
    if (!amend || this.message().trim()) return;
    const last = await this.session.run(() => this.api.versionControl.lastCommitMessage());
    // Whatever the user typed meanwhile wins.
    if (last && this.amend() && !this.message().trim()) this.message.set(last);
  }

  protected stage(paths: string[]) {
    void this.session.run(() => this.api.versionControl.stage(paths));
  }

  protected unstage(paths: string[]) {
    void this.session.run(() => this.api.versionControl.unstage(paths));
  }

  protected async discard(paths: string[]) {
    const single = paths.length === 1;
    const confirmed = await this.dialogs.confirm({
      title: single ? "Discard changes" : `Discard ${paths.length} changes`,
      message: single
        ? `Discard your changes to ${paths[0]}? This cannot be undone.`
        : "Discard all unstaged changes? Untracked files are deleted. This cannot be undone.",
      confirm: "Discard",
      danger: true,
    });
    if (confirmed) await this.session.run(() => this.api.versionControl.discard(paths));
  }

  protected pathsOf(changes: readonly Change[]): string[] {
    return changes.map((change) => change.path);
  }
}
