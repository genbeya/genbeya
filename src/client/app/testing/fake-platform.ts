/** Fakes of the managers and the shell for client tests, with realistic defaults. */
import { type Provider } from "@angular/core";
import type { Mock } from "vitest";
import { MANAGER_METHODS, type Managers } from "../../../contracts/manager-contracts";
import type { ContentArea, ContentBranch, Settings, Snapshot, Storage, Task } from "../../../contracts/model";
import type { ShellContract } from "../../../contracts/shell";
import { MANAGERS, SHELL } from "../platform/platform";

/** Storage with `areas` on the content branch `gitdesk`, pushed to origin, and the other areas in the checkout. */
export function contentBranch(areas: readonly ContentArea[], branch: Partial<ContentBranch> = {}): Storage {
  const mode = (area: ContentArea) => (areas.includes(area) ? "branch" : "checkout");
  return {
    areas: { wiki: mode("wiki"), tasks: mode("tasks"), settings: mode("settings") },
    branch: { name: "gitdesk", remote: "origin", ahead: 0, behind: 0, ...branch },
  };
}

export const SETTINGS: Settings = {
  name: "Test Project",
  wikiRoot: "docs",
  wikiHome: "Home.md",
  taskRoot: "tasks",
  taskPrefix: "TP",
  statuses: ["backlog", "todo", "in-progress", "review", "done"],
  hiddenColumns: [],
};

export function task(id: string, change: Partial<Task> = {}): Task {
  return {
    id,
    path: `tasks/${id}.md`,
    title: `Task ${id}`,
    status: "todo",
    priority: "none",
    assignee: "",
    labels: [],
    body: "",
    epic: "",
    hash: `hash-${id}`,
    comments: [],
    ...change,
  };
}

export function snapshot(change: Partial<Snapshot> = {}): Snapshot {
  return {
    version: "v1",
    location: { kind: "local", path: "/repo" },
    settings: SETTINGS,
    settingsHash: "settings-hash",
    storage: { areas: { wiki: "checkout", tasks: "checkout", settings: "checkout" }, branch: null },
    head: { branch: "main", commit: "abc1234", upstream: null, ahead: 0, behind: 0 },
    branches: ["main"],
    remoteBranches: [],
    remotes: [],
    changes: [],
    files: [{ name: "docs", path: "docs", children: [{ name: "Home.md", path: "docs/Home.md" }] }],
    wiki: [{ title: "Home", path: "docs/Home.md", folder: null, children: [] }],
    tasks: [],
    warnings: [],
    ...change,
  };
}

type MockedManagers = { [K in keyof Managers]: { [M in keyof Managers[K]]: Mock } };

/** Every manager method as a mock; workspace calls resolve to sensible defaults. */
export function fakeManagers(): MockedManagers {
  const managers = Object.fromEntries(
    Object.entries(MANAGER_METHODS).map(([name, methods]) => [
      name,
      Object.fromEntries(methods.map((method) => [method, vi.fn(async () => undefined)])),
    ]),
  ) as unknown as MockedManagers;
  managers.workspace.preferences.mockResolvedValue({ theme: "system", reopenLast: true, autoSyncContent: false });
  managers.workspace.restore.mockResolvedValue(null);
  managers.workspace.recent.mockResolvedValue([]);
  managers.workspace.distributions.mockResolvedValue([]);
  managers.workspace.snapshot.mockResolvedValue(null);
  managers.workspace.open.mockResolvedValue({ id: "w1", snapshot: snapshot() });
  managers.content.agentFiles.mockResolvedValue([]);
  return managers;
}

export type FakeShell = { [K in keyof ShellContract]: ShellContract[K] extends (...args: never[]) => unknown ? Mock : ShellContract[K] };

export function fakeShell(): FakeShell {
  return {
    runtime: "electron",
    pickFolder: vi.fn(async () => null),
    openExternal: vi.fn(async () => undefined),
    setTitle: vi.fn(),
    setTheme: vi.fn(),
    launchArgs: vi.fn(async () => []),
    onSecondLaunch: vi.fn(() => () => undefined),
    guardClose: vi.fn(() => () => undefined),
  };
}

export function providePlatform(managers = fakeManagers(), shell = fakeShell()): Provider[] {
  return [
    { provide: MANAGERS, useValue: managers },
    { provide: SHELL, useValue: shell },
  ];
}
