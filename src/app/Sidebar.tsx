import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  ChevronsUpDown,
  CloudDownload,
  Code2,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  History,
  LayoutGrid,
  Monitor,
  RefreshCw,
  Search,
  Server,
  Settings,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { describeLocation, sameLocation, type RecentEntry } from "../../shared/api";
import { api } from "../api";
import { Kbd, Spinner } from "../components/controls";
import { Menu, type MenuItem } from "../components/Menu";
import { modKey } from "./hotkeys";
import { useRouter, type View } from "./router";
import { useShell } from "./Shell";
import { useWorkspace } from "./workspace";
import "./Sidebar.css";

export const NAV: { view: View; label: string; icon: typeof BookOpen }[] = [
  { view: "wiki", label: "Wiki", icon: BookOpen },
  { view: "tasks", label: "Tasks", icon: LayoutGrid },
  { view: "code", label: "Code", icon: Code2 },
  { view: "changes", label: "Changes", icon: GitCommitHorizontal },
  { view: "history", label: "History", icon: History },
];

export function initials(name: string) {
  const words = name.split(/[\s_-]+/).filter(Boolean);
  const capitals = name.match(/[A-Z]/g);
  return (words.length > 1 ? words.map((w) => w[0]).join("") : capitals && capitals.length > 1 ? capitals.join("") : name.slice(0, 2))
    .slice(0, 2)
    .toUpperCase();
}

export const hostIcon = (kind: string, size = 13) =>
  kind === "ssh" ? <Server size={size} /> : kind === "wsl" ? <Monitor size={size} /> : <FolderOpen size={size} />;

export function Sidebar() {
  const { snapshot, run, busy } = useWorkspace();
  const { route, navigate } = useRouter();
  const shell = useShell();
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  useEffect(() => {
    void api().recent().then(setRecent);
  }, [snapshot.location]);

  const { head, storage, changes, tasks, settings } = snapshot;
  const others = recent.filter((r) => !sameLocation(r.location, snapshot.location)).slice(0, 8);
  const switcher = (): MenuItem[] => [
    ...(others.length ? [{ heading: "Recent" } as MenuItem] : []),
    ...others.map(
        (r): MenuItem => ({
          label: r.name,
          icon: hostIcon(r.location.kind),
          hint: r.location.kind !== "local" ? r.location.kind.toUpperCase() : undefined,
          onSelect: () => void shell.repository.open(r.location),
        }),
      ),
    ...(others.length ? ["separator" as const] : []),
    { label: "Open folder…", icon: <FolderOpen size={14} />, hint: `${modKey}+O`, onSelect: () => void shell.repository.pick() },
    { label: "Open on WSL or SSH…", icon: <Server size={14} />, onSelect: shell.openRemote },
    { label: "Clone repository…", icon: <CloudDownload size={14} />, onSelect: shell.openClone },
    "separator",
    { label: "Close repository", icon: <X size={14} />, onSelect: () => void shell.repository.close() },
  ];

  return (
    <aside className="sidebar">
      <Menu
        width={280}
        items={switcher}
        trigger={({ toggle, ref, open }) => (
          <button ref={ref} className={`workspace-switcher ${open ? "is-open" : ""}`} onClick={toggle}>
            <span className="workspace-mark">{initials(settings.name)}</span>
            <span className="grow">
              <span className="workspace-name ellipsis">{settings.name}</span>
              <span className="workspace-location ellipsis" title={describeLocation(snapshot.location)}>
                {snapshot.location.kind !== "local" && (
                  <span className="host-badge">{snapshot.location.kind === "wsl" ? snapshot.location.distro : "SSH"}</span>
                )}
                {describeLocation(snapshot.location).split(/[\\/:]/).filter(Boolean).pop()}
              </span>
            </span>
            <ChevronsUpDown size={14} className="faint" />
          </button>
        )}
      />

      <button className="sidebar-search" onClick={() => shell.openPalette()}>
        <Search size={14} />
        <span className="grow">Search</span>
        <Kbd>{modKey} K</Kbd>
      </button>

      <nav className="sidebar-nav">
        {NAV.map(({ view, label, icon: Icon }, i) => (
          <button
            key={view}
            className={`nav-item ${route.view === view ? "is-active" : ""}`}
            onClick={() => navigate({ view } as never)}
            title={`${label} (${modKey}+${i + 1})`}
          >
            <Icon size={16} />
            <span className="grow">{label}</span>
            {view === "tasks" && tasks.length > 0 && <span className="nav-count">{tasks.filter((t) => t.status !== settings.statuses.at(-1)).length}</span>}
            {view === "changes" && changes.length > 0 && <span className="nav-count is-accent">{changes.length}</span>}
          </button>
        ))}
      </nav>

      <div className="grow" />

      {storage.mode === "branch" && (
        <div className="content-sync" title={`Wiki and tasks are stored on the ${storage.branch} branch`}>
          <BookOpen size={14} />
          <span className="grow ellipsis">{storage.branch}</span>
          {storage.ahead > 0 && (
            <span className="sync-count">
              <ArrowUp size={11} />
              {storage.ahead}
            </span>
          )}
          {storage.behind > 0 && (
            <span className="sync-count">
              <ArrowDown size={11} />
              {storage.behind}
            </span>
          )}
          <button
            className="sync-button"
            disabled={busy}
            aria-label="Sync wiki and tasks"
            title="Sync wiki and tasks with the remote"
            onClick={() => void run(() => api().syncContent(), "Wiki and tasks are in sync")}
          >
            {busy ? <Spinner size={12} /> : <RefreshCw size={13} />}
          </button>
        </div>
      )}

      <button className="branch-button" onClick={() => shell.openPalette("branches")} title="Switch branch">
        <GitBranch size={14} />
        <span className="grow ellipsis">{head.branch ?? (head.commit ? `detached at ${head.commit}` : "no commits")}</span>
        {head.ahead > 0 && (
          <span className="sync-count">
            <ArrowUp size={11} />
            {head.ahead}
          </span>
        )}
        {head.behind > 0 && (
          <span className="sync-count">
            <ArrowDown size={11} />
            {head.behind}
          </span>
        )}
      </button>

      <button
        className={`nav-item ${route.view === "settings" ? "is-active" : ""}`}
        onClick={() => navigate({ view: "settings" })}
      >
        <Settings size={16} />
        <span className="grow">Settings</span>
      </button>
    </aside>
  );
}
