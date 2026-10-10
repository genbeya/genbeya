import { CdkMenu, CdkMenuTrigger } from "@angular/cdk/menu";
import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";
import { RouterLink, RouterLinkActive } from "@angular/router";
import {
  LucideArrowDown,
  LucideArrowUp,
  LucideBookOpen,
  LucideChevronsUpDown,
  LucideCloudDownload,
  LucideCodeXml,
  LucideFolderOpen,
  LucideGitBranch,
  LucideGitCommitHorizontal,
  LucideHistory,
  LucideLayoutGrid,
  LucideRefreshCw,
  LucideSearch,
  LucideServer,
  LucideSettings,
  LucideX,
} from "@lucide/angular";
import { CONTENT_AREAS, describeLocation, sameLocation, syncsContentBranch } from "../../../../contracts/model";
import { MOD_KEY } from "../../core/hotkeys";
import { Repositories } from "../../core/repositories";
import { Session } from "../../core/session";
import { MenuItem } from "../../ui/menu-item";
import { AREA_NAMES } from "../settings/content-areas";
import { RepositoryActions } from "./repository-actions";
import { HostIcon, initials } from "./repository-mark";
import { ShellUi } from "./shell-ui";

export const VIEWS = ["wiki", "tasks", "code", "changes", "history"] as const;
export type View = (typeof VIEWS)[number];

@Component({
  selector: "gd-sidebar",
  imports: [
    CdkMenu,
    CdkMenuTrigger,
    RouterLink,
    RouterLinkActive,
    MenuItem,
    HostIcon,
    LucideArrowDown,
    LucideArrowUp,
    LucideBookOpen,
    LucideChevronsUpDown,
    LucideCloudDownload,
    LucideCodeXml,
    LucideFolderOpen,
    LucideGitBranch,
    LucideGitCommitHorizontal,
    LucideHistory,
    LucideLayoutGrid,
    LucideRefreshCw,
    LucideSearch,
    LucideServer,
    LucideSettings,
    LucideX,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: "./sidebar.css",
  host: { class: "sidebar" },
  templateUrl: "./sidebar.html",
})
export class Sidebar {
  protected readonly session = inject(Session);
  protected readonly ui = inject(ShellUi);
  protected readonly actions = inject(RepositoryActions);
  protected readonly mod = MOD_KEY;
  protected readonly snapshot = computed(() => this.session.snapshot()!);
  protected readonly mark = computed(() => initials(this.snapshot().settings.name));
  protected readonly folderName = computed(
    () =>
      describeLocation(this.snapshot().location)
        .split(/[\\/:]/)
        .filter(Boolean)
        .pop() ?? "",
  );
  protected readonly hostBadge = computed(() => {
    const location = this.snapshot().location;
    return location.kind === "wsl" ? location.distro : location.kind === "ssh" ? "SSH" : null;
  });
  protected readonly locationText = computed(() => describeLocation(this.snapshot().location));
  /** The content branch while it has something to sync, and what it holds. */
  protected readonly contentBranch = computed(() => {
    const storage = this.snapshot().storage;
    if (!syncsContentBranch(storage)) return null;
    const names = CONTENT_AREAS.filter((area) => storage.areas[area] === "branch").map((area) => AREA_NAMES[area]);
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
    const holds = list
      ? `The ${storage.branch.name} branch holds ${list}`
      : `The ${storage.branch.name} branch holds no area any more; sync to share that`;
    return { ...storage.branch, holds };
  });
  protected readonly openTasks = computed(() => {
    const { tasks, settings } = this.snapshot();
    return tasks.filter((task) => task.status !== settings.statuses.at(-1)).length;
  });
  private readonly recent = inject(Repositories).recent;
  protected readonly others = computed(() =>
    this.recent()
      .filter((entry) => !sameLocation(entry.location, this.snapshot().location))
      .slice(0, 8),
  );
}
