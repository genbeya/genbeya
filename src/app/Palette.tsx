import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BookOpen,
  CircleDot,
  CloudDownload,
  FileCode2,
  FileText,
  FolderOpen,
  GitBranch,
  GitBranchPlus,
  Keyboard,
  Moon,
  Plus,
  RefreshCw,
  Server,
  Sun,
  SunMoon,
  X,
} from "lucide-react";
import type { FileNode, RecentEntry, WikiNode } from "../../shared/api";
import { sameLocation } from "../../shared/api";
import { api } from "../api";
import { useDialogs } from "../components/Dialog";
import { Kbd } from "../components/controls";
import { useWikiActions } from "../views/wiki/actions";
import { modKey } from "./hotkeys";
import { useRouter } from "./router";
import { useShell } from "./Shell";
import { hostIcon, NAV } from "./Sidebar";
import { useWorkspace } from "./workspace";
import { score } from "./fuzzy";
import "./Palette.css";

export type PaletteMode = "all" | "branches";

const GROUP_WEIGHT: Record<string, number> = { Pages: 40, Tasks: 30, "Go to": 20, Actions: 10 };

interface Item {
  id: string;
  group: string;
  label: string;
  detail?: string;
  icon: ReactNode;
  hint?: ReactNode;
  /** Extra text that matches but is not shown. */
  keywords?: string;
  run(): void;
}

const flatPages = (nodes: WikiNode[], trail: string[] = []): { title: string; path: string; trail: string }[] =>
  nodes.flatMap((n) => [
    ...(n.path ? [{ title: n.title, path: n.path, trail: trail.join(" / ") }] : []),
    ...flatPages(n.children, [...trail, n.title]),
  ]);

const flatFiles = (nodes: FileNode[]): string[] =>
  nodes.flatMap((n) => (n.children ? flatFiles(n.children) : [n.path]));

export function Palette({ mode, onClose }: { mode: PaletteMode; onClose(): void }) {
  const { snapshot, run, preferences, setPreferences } = useWorkspace();
  const router = useRouter();
  const shell = useShell();
  const dialogs = useDialogs();
  const wiki = useWikiActions();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api().recent().then(setRecent);
  }, []);

  const createBranch = async (initial = "") => {
    const name = await dialogs.prompt({
      title: "Create branch",
      label: "Branch name",
      initial,
      placeholder: "feature/my-change",
      confirm: "Create and switch",
      hint: "Starts from the current commit. Uncommitted changes come along.",
    });
    if (name) await run(() => api().createBranch(name), `Switched to ${name}`);
  };

  const items = useMemo<Item[]>(() => {
    const { head, branches, remoteBranches, remotes, storage, wiki: pages, tasks, files } = snapshot;
    if (mode === "branches")
      return [
        ...branches.map((b) => ({
          id: "branch:" + b,
          group: "Branches",
          label: b,
          icon: b === head.branch ? <CircleDot size={15} /> : <GitBranch size={15} />,
          hint: b === head.branch ? "current" : undefined,
          run: () => b !== head.branch && void run(() => api().switchBranch(b), `Switched to ${b}`),
        })),
        ...remoteBranches.map((b) => ({
          id: "remote:" + b,
          group: "Remote branches",
          label: b,
          icon: <CloudDownload size={15} />,
          run: () => void run(() => api().switchBranch(b), `Checked out ${b.slice(b.indexOf("/") + 1)}`),
        })),
        {
          id: "create-branch",
          group: "Actions",
          label: "Create branch…",
          icon: <GitBranchPlus size={15} />,
          run: () => void createBranch(query),
        },
      ];

    const remote = head.upstream?.split("/")[0] ?? remotes[0]?.name;
    const go = NAV.map((n, i) => ({
      id: "go:" + n.view,
      group: "Go to",
      label: n.label,
      icon: <n.icon size={15} />,
      hint: <Kbd>{`${modKey} ${i + 1}`}</Kbd>,
      run: () => router.navigate({ view: n.view } as never),
    }));
    const commands: Item[] = [
      { id: "new-page", group: "Actions", label: "New page…", icon: <Plus size={15} />, run: () => void wiki.createPage() },
      {
        id: "new-task",
        group: "Actions",
        label: "New task",
        icon: <Plus size={15} />,
        hint: <Kbd>C</Kbd>,
        run: () => router.navigate({ view: "tasks", create: snapshot.settings.statuses[0] }),
      },
      { id: "switch-branch", group: "Actions", label: "Switch branch…", icon: <GitBranch size={15} />, run: () => shell.openPalette("branches") },
      { id: "create-branch", group: "Actions", label: "Create branch…", icon: <GitBranchPlus size={15} />, run: () => void createBranch() },
      ...(remote
        ? [
            { id: "fetch", group: "Actions", label: `Fetch from ${remote}`, icon: <RefreshCw size={15} />, run: () => void run(() => api().sync("fetch", remote), "Fetched") },
            { id: "pull", group: "Actions", label: `Pull from ${remote}`, icon: <ArrowDownToLine size={15} />, run: () => void run(() => api().sync("pull", remote), "Pulled") },
            { id: "push", group: "Actions", label: `Push to ${remote}`, icon: <ArrowUpFromLine size={15} />, run: () => void run(() => api().sync("push", remote), "Pushed") },
          ]
        : []),
      ...(storage.mode === "branch"
        ? [{ id: "sync-content", group: "Actions", label: "Sync wiki and tasks", icon: <RefreshCw size={15} />, run: () => void run(() => api().syncContent(), "Wiki and tasks are in sync") }]
        : []),
      { id: "open", group: "Repository", label: "Open folder…", icon: <FolderOpen size={15} />, hint: <Kbd>{`${modKey} O`}</Kbd>, run: () => void shell.repository.pick() },
      { id: "open-remote", group: "Repository", label: "Open on WSL or SSH…", icon: <Server size={15} />, run: shell.openRemote },
      { id: "clone", group: "Repository", label: "Clone repository…", icon: <CloudDownload size={15} />, run: shell.openClone },
      { id: "close", group: "Repository", label: "Close repository", icon: <X size={15} />, run: () => void shell.repository.close() },
      ...recent
        .filter((r) => !sameLocation(r.location, snapshot.location))
        .map((r) => ({
          id: "recent:" + JSON.stringify(r.location),
          group: "Repository",
          label: `Open ${r.name}`,
          icon: hostIcon(r.location.kind, 15),
          run: () => void shell.repository.open(r.location),
        })),
      ...(["dark", "light", "system"] as const).map((theme) => ({
        id: "theme:" + theme,
        group: "Preferences",
        label: `Theme: ${theme[0].toUpperCase() + theme.slice(1)}`,
        icon: theme === "dark" ? <Moon size={15} /> : theme === "light" ? <Sun size={15} /> : <SunMoon size={15} />,
        hint: preferences.theme === theme ? "current" : undefined,
        run: () => void setPreferences({ theme }),
      })),
      { id: "help", group: "Preferences", label: "Keyboard shortcuts", icon: <Keyboard size={15} />, hint: <Kbd>?</Kbd>, run: shell.showHelp },
    ];
    const pageItems = flatPages(pages).map((p) => ({
      id: "page:" + p.path,
      group: "Pages",
      label: p.title,
      detail: p.trail,
      icon: <BookOpen size={15} />,
      keywords: p.path,
      run: () => router.navigate({ view: "wiki", page: p.path }),
    }));
    const taskItems = tasks.map((t) => ({
      id: "task:" + t.path,
      group: "Tasks",
      label: t.title,
      detail: t.id,
      icon: <FileText size={15} />,
      keywords: `${t.id} ${t.assignee} ${t.labels.join(" ")}`,
      run: () => router.navigate({ view: "tasks", task: t.id }),
    }));
    // Wiki pages and tasks already have their own entries.
    const { wikiRoot, taskRoot } = snapshot.settings;
    const own = (path: string) => storage.mode === "worktree" && (path.startsWith(wikiRoot + "/") || path.startsWith(taskRoot + "/"));
    const fileItems = flatFiles(files).filter((path) => !own(path)).map((path) => ({
      id: "file:" + path,
      group: "Files",
      label: path.slice(path.lastIndexOf("/") + 1),
      detail: path.slice(0, path.lastIndexOf("/")),
      icon: <FileCode2 size={15} />,
      keywords: path,
      run: () => router.navigate({ view: "code", file: path }),
    }));
    return [...go, ...commands, ...pageItems, ...taskItems, ...fileItems];
  }, [snapshot, mode, recent, preferences.theme, query]);

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) {
      if (mode === "branches") return items;
      // Without a query, offer navigation and actions, then pages and tasks.
      return items.filter((i) => i.group !== "Files").slice(0, 60);
    }
    const scored = items
      .map((item) => ({
        item,
        score:
          Math.max(score(item.label, q), score(item.keywords ?? "", q) - 100, score(item.detail ?? "", q) - 200) +
          (GROUP_WEIGHT[item.group] ?? 0),
      }))
      .filter((r) => r.score >= 0)
      .sort((a, b) => b.score - a.score);
    // Groups appear in the order of their best match, each capped.
    const groups = new Map<string, Item[]>();
    for (const { item } of scored) {
      const list = groups.get(item.group) ?? [];
      if (list.length < 8) list.push(item);
      groups.set(item.group, list);
    }
    return [...groups.values()].flat();
  }, [items, query, mode]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector(".palette-item.is-active")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (item: Item | undefined) => {
    if (!item) return;
    onClose();
    item.run();
  };

  let lastGroup = "";
  return (
    <div className="dialog-backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label={mode === "branches" ? "Switch branch" : "Command palette"}>
        <input
          autoFocus
          className="palette-input"
          placeholder={mode === "branches" ? "Switch to branch…" : "Search pages, tasks, files and commands…"}
          value={query}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const step = e.key === "ArrowDown" ? 1 : -1;
              setActive((a) => (a + step + results.length) % Math.max(1, results.length));
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(results[active]);
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }
          }}
        />
        <div className="palette-list" ref={list} role="listbox">
          {results.map((item, index) => {
            const heading = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <div key={item.id}>
                {heading && <div className="palette-group">{heading}</div>}
                <button
                  role="option"
                  aria-selected={index === active}
                  className={`palette-item ${index === active ? "is-active" : ""}`}
                  onMouseMove={() => setActive(index)}
                  onClick={() => choose(item)}
                >
                  <span className="palette-icon">{item.icon}</span>
                  <span className="ellipsis">{item.label}</span>
                  {item.detail && <span className="palette-detail ellipsis">{item.detail}</span>}
                  <span className="grow" />
                  {item.hint && <span className="palette-hint">{item.hint}</span>}
                </button>
              </div>
            );
          })}
          {!results.length && <div className="palette-empty">No matches</div>}
        </div>
      </div>
    </div>
  );
}
