/** What the command palette offers, and how a query ranks it. */
import type { GitdeskLink } from "../../../../contracts/gitdesk-link";
import type { RecentEntry, Snapshot, Theme } from "../../../../contracts/model";
import { sameLocation } from "../../../../contracts/model";
import { describeLinkItem, parseGitdeskLink } from "../../../../utilities/gitdesk-link";
import { parseRemote } from "../../../../utilities/remote-url";
import { filePaths } from "../../../../utilities/file-tree";
import { flattenPages } from "../wiki/wiki-pages";
import { fuzzyScore } from "./fuzzy";

export type PaletteIcon =
  | "page"
  | "task"
  | "file"
  | "branch"
  | "current-branch"
  | "remote-branch"
  | "add"
  | "add-branch"
  | "fetch"
  | "pull"
  | "push"
  | "sync"
  | "folder"
  | "server"
  | "clone"
  | "close"
  | "local"
  | "wsl"
  | "ssh"
  | "dark"
  | "light"
  | "system"
  | "minimap"
  | "keyboard"
  | "wiki"
  | "tasks"
  | "code"
  | "changes"
  | "history"
  | "terminal"
  | "link"
  | "tour"
  | "news"
  | "docs"
  | "search";

export interface PaletteItem {
  readonly id: string;
  readonly group: string;
  readonly label: string;
  readonly detail?: string;
  readonly icon: PaletteIcon;
  readonly hint?: string;
  /** Text that matches without being shown. */
  readonly keywords?: string;
  readonly run: () => unknown;
}

/** The callbacks items run; the palette closes before any of them. */
export interface PaletteCommands {
  go(view: "wiki" | "tasks" | "code" | "changes" | "history"): void;
  openPage(path: string): void;
  openTask(id: string): void;
  openFile(path: string): void;
  newPage(): void;
  newTask(): void;
  switchBranch(name: string): void;
  createBranch(name: string): void;
  showBranches(): void;
  /** Reopens the palette for searching inside files. */
  searchText(): void;
  sync(action: "fetch" | "pull" | "push", remote: string): void;
  syncContent(): void;
  pickFolder(): void;
  openRemote(): void;
  openClone(): void;
  closeRepository(): void;
  openRecent(entry: RecentEntry): void;
  setTheme(theme: Theme): void;
  toggleMinimap(): void;
  showHelp(): void;
  toggleTerminal(): void;
  openLink(link: GitdeskLink): void;
  startTour(): void;
  showWhatsNew(): void;
  openDocs(): void;
}

const GROUP_WEIGHT: Readonly<Record<string, number>> = { Pages: 40, Tasks: 30, "Go to": 20, Actions: 10 };
const PER_GROUP = 8;
const WITHOUT_QUERY = 60;

export function branchItems(snapshot: Snapshot, query: string, commands: PaletteCommands): PaletteItem[] {
  const { head, branches, remoteBranches } = snapshot;
  return [
    ...branches.map((branch): PaletteItem => ({
      id: `branch:${branch}`,
      group: "Branches",
      label: branch,
      icon: branch === head.branch ? "current-branch" : "branch",
      ...(branch === head.branch ? { hint: "current" } : {}),
      run: () => branch !== head.branch && commands.switchBranch(branch),
    })),
    ...remoteBranches.map((branch): PaletteItem => ({
      id: `remote:${branch}`,
      group: "Remote branches",
      label: branch,
      icon: "remote-branch",
      run: () => commands.switchBranch(branch),
    })),
    { id: "create-branch", group: "Actions", label: "Create branch…", icon: "add-branch", run: () => commands.createBranch(query) },
  ];
}

export function allItems(
  snapshot: Snapshot,
  recent: readonly RecentEntry[],
  theme: Theme,
  /** How the platform names the modifiers ("⌘", "⌃" and "⇧" on macOS). */
  keys: { readonly mod: string; readonly ctrl: string; readonly shift?: string },
  commands: PaletteCommands,
): PaletteItem[] {
  const { head, remotes, storage, wiki, tasks, files, settings } = snapshot;
  const { mod, ctrl, shift = "Shift" } = keys;
  const remote = head.upstream?.split("/")[0] ?? remotes[0]?.name;
  const views = [
    ["wiki", "Wiki"],
    ["tasks", "Tasks"],
    ["code", "Code"],
    ["changes", "Changes"],
    ["history", "History"],
  ] as const;
  const go = views.map(([view, label], i): PaletteItem => ({
    id: `go:${view}`,
    group: "Go to",
    label,
    icon: view,
    hint: `${mod} ${i + 1}`,
    run: () => commands.go(view),
  }));
  const actions: PaletteItem[] = [
    { id: "new-page", group: "Actions", label: "New page…", icon: "add", hint: "N", run: () => commands.newPage() },
    { id: "new-task", group: "Actions", label: "New task", icon: "add", hint: "C", run: () => commands.newTask() },
    {
      id: "search-text",
      group: "Actions",
      label: "Search in files…",
      icon: "search",
      hint: `${mod} ${shift} F`,
      keywords: "find text grep",
      run: () => commands.searchText(),
    },
    { id: "switch-branch", group: "Actions", label: "Switch branch…", icon: "branch", run: () => commands.showBranches() },
    {
      id: "terminal",
      group: "Actions",
      label: "Toggle terminal",
      icon: "terminal",
      hint: `${ctrl} \``,
      run: () => commands.toggleTerminal(),
    },
    { id: "create-branch", group: "Actions", label: "Create branch…", icon: "add-branch", run: () => commands.createBranch("") },
    ...(remote
      ? ([
          { id: "fetch", group: "Actions", label: `Fetch from ${remote}`, icon: "fetch", run: () => commands.sync("fetch", remote) },
          { id: "pull", group: "Actions", label: `Pull from ${remote}`, icon: "pull", run: () => commands.sync("pull", remote) },
          { id: "push", group: "Actions", label: `Push to ${remote}`, icon: "push", run: () => commands.sync("push", remote) },
        ] satisfies PaletteItem[])
      : []),
    ...(storage.mode === "branch"
      ? [
          {
            id: "sync-content",
            group: "Actions",
            label: "Sync wiki and tasks",
            icon: "sync",
            run: () => commands.syncContent(),
          } satisfies PaletteItem,
        ]
      : []),
  ];
  const repository: PaletteItem[] = [
    { id: "open", group: "Repository", label: "Open folder…", icon: "folder", hint: `${mod} O`, run: () => commands.pickFolder() },
    { id: "open-remote", group: "Repository", label: "Open on WSL or SSH…", icon: "server", run: () => commands.openRemote() },
    { id: "clone", group: "Repository", label: "Clone repository…", icon: "clone", run: () => commands.openClone() },
    { id: "close", group: "Repository", label: "Close repository", icon: "close", run: () => commands.closeRepository() },
    ...recent
      .filter((entry) => !sameLocation(entry.location, snapshot.location))
      .map((entry): PaletteItem => ({
        id: `recent:${JSON.stringify(entry.location)}`,
        group: "Repository",
        label: `Open ${entry.name}`,
        icon: entry.location.kind,
        run: () => commands.openRecent(entry),
      })),
  ];
  const preferences: PaletteItem[] = [
    ...(["dark", "light", "system"] as const).map((option): PaletteItem => ({
      id: `theme:${option}`,
      group: "Preferences",
      label: `Theme: ${option[0]!.toUpperCase()}${option.slice(1)}`,
      icon: option,
      ...(theme === option ? { hint: "current" } : {}),
      run: () => commands.setTheme(option),
    })),
    { id: "minimap", group: "Preferences", label: "Toggle minimap", icon: "minimap", run: () => commands.toggleMinimap() },
    { id: "help", group: "Preferences", label: "Keyboard shortcuts", icon: "keyboard", hint: "?", run: () => commands.showHelp() },
  ];
  const help: PaletteItem[] = [
    { id: "tour", group: "Help", label: "Start the tour", icon: "tour", keywords: "onboarding guide", run: () => commands.startTour() },
    {
      id: "news",
      group: "Help",
      label: "Show what's new",
      icon: "news",
      keywords: "changelog release notes",
      run: () => commands.showWhatsNew(),
    },
    { id: "docs", group: "Help", label: "Open the documentation", icon: "docs", keywords: "help manual", run: () => commands.openDocs() },
  ];
  const pages = flattenPages(wiki).map((page): PaletteItem => ({
    id: `page:${page.path}`,
    group: "Pages",
    label: page.title,
    detail: page.trail.join(" / "),
    icon: "page",
    keywords: page.path,
    run: () => commands.openPage(page.path),
  }));
  const taskItems = tasks.map((task): PaletteItem => ({
    id: `task:${task.path}`,
    group: "Tasks",
    label: task.title,
    detail: task.id,
    icon: "task",
    keywords: `${task.id} ${task.assignee} ${task.labels.join(" ")}`,
    run: () => commands.openTask(task.id),
  }));
  // Pages and tasks have their own entries when they live in the checkout.
  const own = (path: string) =>
    storage.mode === "worktree" && (path.startsWith(`${settings.wikiRoot}/`) || path.startsWith(`${settings.taskRoot}/`));
  const fileItems = filePaths(files)
    .filter((path) => !own(path))
    .map((path): PaletteItem => ({
      id: `file:${path}`,
      group: "Files",
      label: path.slice(path.lastIndexOf("/") + 1),
      detail: path.slice(0, Math.max(0, path.lastIndexOf("/"))),
      icon: "file",
      keywords: path,
      run: () => commands.openFile(path),
    }));
  return [...go, ...actions, ...repository, ...preferences, ...help, ...pages, ...taskItems, ...fileItems];
}

/** "Open link" when the query is a GitDesk link, as pasted from a coworker; it replaces every other result. */
export function linkItem(query: string, commands: PaletteCommands): PaletteItem | null {
  const link = parseGitdeskLink(query);
  const repository = link && parseRemote(link.remote);
  if (!link || !repository) return null;
  return {
    id: "open-link",
    group: "GitDesk link",
    label: "Open link",
    detail: `${describeLinkItem(link.item)} in ${repository.host}/${repository.path}`,
    icon: "link",
    run: () => commands.openLink(link),
  };
}

/** Ranks items for a query; groups appear in the order of their best match, each capped. */
export function rank(items: readonly PaletteItem[], query: string, keepOrder: boolean): PaletteItem[] {
  const needle = query.trim();
  if (!needle) return keepOrder ? [...items] : items.filter((item) => item.group !== "Files").slice(0, WITHOUT_QUERY);
  const scored = items
    .map((item) => ({
      item,
      score:
        Math.max(
          fuzzyScore(item.label, needle),
          fuzzyScore(item.keywords ?? "", needle) - 100,
          fuzzyScore(item.detail ?? "", needle) - 200,
        ) + (GROUP_WEIGHT[item.group] ?? 0),
    }))
    .filter(({ score }) => score >= 0)
    .sort((a, b) => b.score - a.score);
  const groups = new Map<string, PaletteItem[]>();
  for (const { item } of scored) {
    const group = groups.get(item.group) ?? [];
    if (group.length < PER_GROUP) group.push(item);
    groups.set(item.group, group);
  }
  return [...groups.values()].flat();
}
