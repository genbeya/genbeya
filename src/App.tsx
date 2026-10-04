import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  BookOpen,
  LayoutGrid,
  Code2,
  GitBranch,
  Settings2,
  Plus,
  Search,
  FolderOpen,
  ArrowUpRight,
  ChevronRight,
  ChevronDown,
  FileText,
  Folder,
  RefreshCw,
  Check,
  X,
  Save,
  GitCommitHorizontal,
  Download,
  Upload,
  Circle,
  ArrowLeft,
  Pencil,
  Eye,
  Layers,
  AlertCircle,
  CheckCheck,
  MoreHorizontal,
  Terminal,
  Command,
  Network,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SourceEditor, SourceDiff } from "./editor";
import { CommitGraph } from "./graph";
import type {
  Commit,
  DesktopAPI,
  Diff,
  FileContent,
  FileNode,
  Settings,
  Snapshot,
  Task,
  TaskInput,
  WikiNode,
} from "../shared/types";
declare global {
  interface Window {
    gitdesk: DesktopAPI;
  }
}
const api = window.gitdesk;
type View = "wiki" | "tasks" | "code" | "git" | "settings";
const title = (s: string) =>
  s.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const initials = (s: string) =>
  s
    .split(/[\s-]+/)
    .map((v) => v[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
const taskInput = (t: Task): TaskInput => ({
  title: t.title,
  status: t.status,
  priority: t.priority,
  assignee: t.assignee,
  labels: t.labels,
  body: t.body,
});
function Modal({
  title: heading,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", fn);
    return () => document.removeEventListener("keydown", fn);
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className={"modal " + (wide ? "wide" : "")}
        role="dialog"
        aria-modal="true"
        aria-label={heading}
      >
        <header>
          <h2>{heading}</h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
function FileTree({
  nodes,
  selected,
  onOpen,
  depth = 0,
}: {
  nodes: FileNode[];
  selected: string;
  onOpen: (p: string) => void;
  depth?: number;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  return (
    <>
      {nodes.map((n) => (
        <div key={n.path}>
          <button
            className={"tree-row " + (selected === n.path ? "active" : "")}
            style={{ paddingLeft: 14 + depth * 16 }}
            onClick={() =>
              n.directory
                ? setCollapsed((old) => {
                    const next = new Set(old);
                    next.has(n.path) ? next.delete(n.path) : next.add(n.path);
                    return next;
                  })
                : onOpen(n.path)
            }
          >
            {n.directory ? (
              <>
                {collapsed.has(n.path) ? (
                  <ChevronRight size={12} />
                ) : (
                  <ChevronDown size={12} />
                )}
                <Folder size={15} />
              </>
            ) : (
              <>
                <span className="tree-spacer" />
                <FileText size={14} />
              </>
            )}
            <span>{n.name}</span>
          </button>
          {n.directory && !collapsed.has(n.path) && (
            <FileTree
              nodes={n.children ?? []}
              selected={selected}
              onOpen={onOpen}
              depth={depth + 1}
            />
          )}
        </div>
      ))}
    </>
  );
}
function WikiTree({
  nodes,
  selected,
  onOpen,
  depth = 0,
}: {
  nodes: WikiNode[];
  selected: string;
  onOpen: (n: WikiNode) => void;
  depth?: number;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  return (
    <>
      {nodes.map((n) => {
        const key = n.path ?? n.directory!;
        return (
          <div key={key}>
            <div
              className={"wiki-tree-row " + (selected === key ? "active" : "")}
              style={{ paddingLeft: 12 + depth * 16 }}
            >
              {n.children.length > 0 ? (
                <button
                  className="tree-toggle"
                  aria-label={"Toggle " + n.title}
                  onClick={() =>
                    setCollapsed((old) => {
                      const next = new Set(old);
                      next.has(key) ? next.delete(key) : next.add(key);
                      return next;
                    })
                  }
                >
                  {collapsed.has(key) ? (
                    <ChevronRight size={12} />
                  ) : (
                    <ChevronDown size={12} />
                  )}
                </button>
              ) : (
                <span className="tree-spacer" />
              )}
              <button className="wiki-link" onClick={() => onOpen(n)}>
                <FileText size={15} />
                <span>{n.title}</span>
              </button>
            </div>
            {!collapsed.has(key) && (
              <WikiTree
                nodes={n.children}
                selected={selected}
                onOpen={onOpen}
                depth={depth + 1}
              />
            )}
          </div>
        );
      })}
    </>
  );
}
function resolveLink(current: string, link: string) {
  const clean = decodeURIComponent(link.split("#")[0]);
  const parts = (
    clean.startsWith("/")
      ? clean.slice(1)
      : current.slice(0, current.lastIndexOf("/") + 1) + clean
  ).split("/");
  const result: string[] = [];
  for (const p of parts) {
    if (p === "..") result.pop();
    else if (p && p !== ".") result.push(p);
  }
  return result.join("/");
}
export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [view, setView] = useState<View>("wiki");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [file, setFile] = useState<FileContent | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [group, setGroup] = useState<WikiNode | null>(null);
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<"clone" | "page" | "branch" | null>(null);
  const [text, setText] = useState("");
  const [task, setTask] = useState<Task | null>(null);
  const [taskForm, setTaskForm] = useState<TaskInput | null>(null);
  const [labels, setLabels] = useState("");
  const [diff, setDiff] = useState<Diff | null>(null);
  const [diffStaged, setDiffStaged] = useState(false);
  const [gitTab, setGitTab] = useState<"changes" | "history">("changes");
  const [message, setMessage] = useState("");
  const [selectedCommit, setSelectedCommit] = useState<Commit | null>(null);
  const [commitFiles, setCommitFiles] = useState<string[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsBaseHash, setSettingsBaseHash] = useState<string | null>(null);
  const [states, setStates] = useState("");
  const [remoteName, setRemoteName] = useState("origin");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [remote, setRemote] = useState("");
  const dirty = Boolean(file && draft !== file.content);
  const refresh = useCallback(async () => {
    const next = await api.snapshot();
    setSnapshot(next);
    setRemote((old) =>
      next.remotes.some((r) => r.name === old)
        ? old
        : (next.remotes[0]?.name ?? ""),
    );
    return next;
  }, []);
  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError("");
    try {
      return await fn();
    } catch (e) {
      setError(
        String(e instanceof Error ? e.message : e).replace(
          /^Error invoking remote method '[^']+': Error: /,
          "",
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  const leave = () =>
    !dirty || window.confirm("Discard unsaved editor changes?");
  const openFile = async (path: string, edit = false) => {
    if (!leave()) return;
    await run(async () => {
      const f = await api.read(path);
      setFile(f);
      setDraft(f.content);
      setGroup(null);
      setEditing(edit);
    });
  };
  const changeView = (next: View) => {
    if (next === view) return;
    if (!leave()) return;
    setView(next);
    setFile(null);
    setDraft("");
    setGroup(null);
    setQuery("");
    setDiff(null);
    if (next === "settings" && snapshot) {
      setSettings({ ...snapshot.settings });
      setSettingsBaseHash(snapshot.settingsHash);
      setStates(snapshot.settings.statuses.join(", "));
    }
  };
  const switchRepo = async (
    kind: "openRepository" | "createDemo" | "cloneRepository",
    url?: string,
  ) => {
    if (!leave()) return;
    await run(async () => {
      const result =
        kind === "cloneRepository"
          ? await api.cloneRepository(url!)
          : await api[kind]();
      if (!result) return;
      setSnapshot(null);
      setSelectedCommit(null);
      setCommitFiles([]);
      setFile(null);
      setDraft("");
      setGroup(null);
      setDiff(null);
      setView("wiki");
      setQuery("");
      setModal(null);
      const next = await refresh();
      const home = next.settings.wikiRoot + "/" + next.settings.wikiHome;
      try {
        const f = await api.read(home);
        setFile(f);
        setDraft(f.content);
        setEditing(false);
      } catch {
        /* A repository may not have wiki content yet. */
      }
    });
  };
  useEffect(() => {
    if (!snapshot) return;
    const timer = setInterval(() => {
      void refresh().catch(() => {});
    }, 8000);
    return () => clearInterval(timer);
  }, [Boolean(snapshot), refresh]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [dirty]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  const saveFile = () =>
    run(async () => {
      if (!file) return;
      const updated = await api.save(file.path, draft, file.hash);
      setFile(updated);
      await refresh();
      setNotice("Saved to the working tree");
    });
  const openWiki = (node: WikiNode) => {
    if (node.path) void openFile(node.path);
    else if (leave()) {
      setGroup(node);
      setFile(null);
      setDraft("");
    }
  };
  const openTask = (value?: Task) => {
    setTask(value ?? null);
    setTaskForm(
      value
        ? taskInput(value)
        : {
            title: "",
            status: snapshot!.settings.statuses[0],
            priority: "medium",
            assignee: "",
            labels: [],
            body: "",
          },
    );
    setLabels(value?.labels.join(", ") ?? "");
  };
  const saveTask = () =>
    run(async () => {
      if (!taskForm) return;
      const value = {
        ...taskForm,
        labels: labels
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      };
      if (task) await api.updateTask(task.path, value, task.hash);
      else await api.createTask(value);
      setTaskForm(null);
      await refresh();
      setNotice(task ? "Task updated" : "Task created");
    });
  const moveTask = (value: Task, status: string) =>
    run(async () => {
      if (value.status === status) return;
      await api.updateTask(
        value.path,
        { ...taskInput(value), status },
        value.hash,
      );
      await refresh();
    });
  const showDiff = (path: string, staged = false, commit?: string) =>
    run(async () => {
      setDiff(await api.diff(path, staged, commit));
      setDiffStaged(staged);
    });
  const gitAction = (fn: () => Promise<void>) =>
    run(async () => {
      await fn();
      await refresh();
      setDiff(null);
    });
  const submitSimple = () => {
    if (modal === "clone") {
      void switchRepo("cloneRepository", text);
    } else if (modal === "page") {
      void run(async () => {
        const path =
          snapshot!.settings.wikiRoot + "/" + text.replace(/\.md$/, "") + ".md";
        const f = await api.createPage(
          path,
          text.split("/").pop()!.replace(/\.md$/, ""),
        );
        setFile(f);
        setDraft(f.content);
        setEditing(true);
        setGroup(null);
        setModal(null);
        await refresh();
      });
    } else if (modal === "branch") {
      void gitAction(async () => {
        await api.createBranch(text);
        setModal(null);
      });
    }
  };
  const filteredTasks =
    snapshot?.tasks.filter((t) =>
      [t.title, t.id, t.assignee, t.labels.join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
    ) ?? [];
  const filteredWiki = (nodes: WikiNode[]): WikiNode[] =>
    nodes.flatMap((n) => {
      const children = filteredWiki(n.children);
      return n.title.toLowerCase().includes(query.toLowerCase())
        ? [n]
        : children.length
          ? [{ ...n, children }]
          : [];
    });
  const filteredFiles = (nodes: FileNode[]): FileNode[] =>
    nodes.flatMap((n) => {
      const children = n.children ? filteredFiles(n.children) : [];
      return n.path.toLowerCase().includes(query.toLowerCase())
        ? [n]
        : children.length
          ? [{ ...n, children }]
          : [];
    });
  const flatWiki = (nodes: WikiNode[]): WikiNode[] =>
    nodes.flatMap((n) => [n, ...flatWiki(n.children)]);
  const renderMarkdown = (content: string, current: string) => (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => (
          <a
            href={href}
            onClick={(e) => {
              if (href?.startsWith("#")) return;
              e.preventDefault();
              if (!href) return;
              if (/^[a-z]+:/i.test(href) || href.startsWith("//")) {
                setNotice("External links are disabled in this prototype.");
                return;
              }
              try {
                void openFile(resolveLink(current, href));
              } catch {
                setError("Invalid page link.");
              }
            }}
          >
            {children}
          </a>
        ),
        img: () => null,
      }}
    >
      {content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")}
    </ReactMarkdown>
  );
  const primary = (
    label: string,
    fn: () => void,
    icon: ReactNode = <Plus size={15} />,
  ) => (
    <button className="button primary" disabled={busy} onClick={fn}>
      {icon}
      {label}
    </button>
  );
  const alerts = (
    <>
      {error && (
        <div className="alert error" role="alert">
          <AlertCircle size={17} />
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            <X size={15} />
          </button>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={15} />
          {notice}
        </div>
      )}
    </>
  );
  if (!api)
    return (
      <div className="no-bridge">
        <h1>GitDesk</h1>
        <p>
          This is a desktop application. Run <code>npm run dev</code> or{" "}
          <code>npm run build && npm start</code> to access local repositories.
        </p>
      </div>
    );
  return (
    <div className="app-shell" aria-busy={busy}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Layers size={22} />
          </div>
          GitDesk<span className="poc">POC</span>
        </div>
        <div className="project">
          <div className="project-avatar">
            {initials(snapshot?.settings.name ?? "Your workspace")}
          </div>
          <div>
            <strong>{snapshot?.settings.name ?? "Your workspace"}</strong>
            <span>{snapshot ? "Local repository" : "Ready when you are"}</span>
          </div>
        </div>
        {snapshot && (
          <div className="branch-control">
            <GitBranch size={15} />
            <select
              aria-label="Switch branch"
              disabled={busy}
              value={snapshot.branch}
              onChange={(e) => {
                if (leave())
                  void gitAction(async () => {
                    await api.switchBranch(e.target.value);
                    setFile(null);
                    setDraft("");
                  });
              }}
            >
              {!snapshot.branches.includes(snapshot.branch) && (
                <option>{snapshot.branch}</option>
              )}
              {snapshot.branches.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
            <button
              aria-label="Create branch"
              disabled={busy}
              onClick={() => {
                setText("");
                setModal("branch");
              }}
            >
              <Plus size={14} />
            </button>
          </div>
        )}
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {(
            [
              { id: "wiki", label: "Wiki", icon: BookOpen },
              { id: "tasks", label: "Tasks", icon: LayoutGrid },
              { id: "code", label: "Code", icon: Code2 },
              { id: "git", label: "Version control", icon: GitBranch },
            ] as const
          ).map((n) => (
            <button
              key={n.id}
              className={view === n.id && snapshot ? "active" : ""}
              onClick={() => snapshot && changeView(n.id)}
              disabled={!snapshot}
            >
              <n.icon size={18} />
              {n.label}
              {n.id === "tasks" && snapshot && (
                <span className="nav-count">{snapshot.tasks.length}</span>
              )}
              {n.id === "git" && snapshot && snapshot.changes.length > 0 && (
                <span className="nav-count accent">
                  {snapshot.changes.length}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          {snapshot && (
            <div className="repo-info">
              <span className="local-dot" />
              Everything lives in Git
              <code title={snapshot.repo}>
                {snapshot.repo.split(/[\/\\]/).pop()}
              </code>
              <span>
                {snapshot.changes.length === 0
                  ? "Working tree clean"
                  : `${snapshot.changes.length} uncommitted file${snapshot.changes.length === 1 ? "" : "s"}`}
              </span>
            </div>
          )}
          <button
            className="sidebar-action"
            disabled={busy}
            onClick={() => void switchRepo("openRepository")}
          >
            <FolderOpen size={17} />
            {snapshot ? "Open another repository" : "Open repository"}
          </button>
          <button
            className={
              "sidebar-action " + (view === "settings" ? "active" : "")
            }
            disabled={!snapshot}
            onClick={() => changeView("settings")}
          >
            <Settings2 size={17} />
            Project settings
          </button>
          <div className="sidebar-footer">
            <span>GitDesk / 0.1.0</span>
            <Command size={13} />
          </div>
        </div>
      </aside>
      <main className="main">
        <div className="topbar">
          <span>
            {snapshot?.settings.name ?? "Workspace"}
            <ChevronRight size={13} />
            <strong>
              {snapshot
                ? {
                    wiki: "Wiki",
                    tasks: "Tasks",
                    code: "Code",
                    git: "Version control",
                    settings: "Settings",
                  }[view]
                : "Get started"}
            </strong>
          </span>
          <div>
            <span className="local-badge">
              <Circle size={7} fill="currentColor" />
              Local first
            </span>
            {snapshot && (
              <button
                className={"icon-button " + (busy ? "spinning" : "")}
                disabled={busy}
                aria-label="Refresh repository"
                onClick={() => void run(refresh)}
              >
                <RefreshCw size={16} />
              </button>
            )}
          </div>
        </div>
        {alerts}
        {!snapshot ? (
          <div className="onboarding">
            <div className="eyebrow">YOUR REPOSITORY. YOUR WORKSPACE.</div>
            <h1>
              Bring your project
              <br />
              into focus.
            </h1>
            <p>
              Documentation, tasks, and code.
              <br />
              One workspace. One Git repository.
            </p>
            <div className="onboarding-actions">
              {primary(
                "Open a repository",
                () => void switchRepo("openRepository"),
                <FolderOpen size={17} />,
              )}
              <button
                className="button"
                disabled={busy}
                onClick={() => void switchRepo("createDemo")}
              >
                Explore a demo
                <ArrowUpRight size={16} />
              </button>
            </div>
            <div className="feature-cards">
              <div>
                <BookOpen />
                <h3>A wiki that travels</h3>
                <p>Plain Markdown pages, organized by your folder structure.</p>
              </div>
              <div>
                <LayoutGrid />
                <h3>Work, versioned</h3>
                <p>Tasks and boards backed by files you can inspect and own.</p>
              </div>
              <div>
                <GitBranch />
                <h3>Git at the center</h3>
                <p>
                  Read code, review changes, and follow your project’s history.
                </p>
              </div>
            </div>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => {
                setText("");
                setModal("clone");
              }}
            >
              Have a remote repository? Clone it <ArrowUpRight size={14} />
            </button>
            <div className="onboarding-foot">
              <Terminal size={14} />
              Requires Git on your machine · Works offline with local
              repositories
            </div>
          </div>
        ) : (
          <>
            <div className="section-heading">
              <div>
                <div className="eyebrow">
                  {view === "wiki"
                    ? "KNOWLEDGE BASE"
                    : view === "tasks"
                      ? "PROJECT DELIVERY"
                      : view === "code"
                        ? "REPOSITORY EXPLORER"
                        : view === "git"
                          ? "SOURCE CONTROL"
                          : "WORKSPACE CONFIGURATION"}
                </div>
                <h1>
                  {
                    {
                      wiki: "Project wiki",
                      tasks: "Task board",
                      code: "Code",
                      git: "Version control",
                      settings: "Project settings",
                    }[view]
                  }
                </h1>
                <p>
                  {
                    {
                      wiki: "The context behind the code. Written in Markdown, versioned in Git.",
                      tasks:
                        "From idea to done. Every task is a Markdown file.",
                      code: "Explore and edit the files that make your project.",
                      git: "Review your work and keep the story of your project.",
                      settings:
                        "Make the repository work the way your team does.",
                    }[view]
                  }
                </p>
              </div>
              <div className="heading-actions">
                {["wiki", "tasks", "code"].includes(view) && (
                  <label className="search">
                    <Search size={15} />
                    <input
                      aria-label={"Search " + view}
                      placeholder={
                        view === "wiki"
                          ? "Find a page…"
                          : view === "tasks"
                            ? "Filter tasks…"
                            : "Find a file…"
                      }
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    <span>/</span>
                  </label>
                )}
                {view === "wiki" &&
                  primary("New page", () => {
                    setText("");
                    setModal("page");
                  })}
                {view === "tasks" && primary("New task", () => openTask())}
              </div>
            </div>
            {snapshot.warnings.length > 0 && (
              <details className="warnings">
                <summary>
                  {snapshot.warnings.length} repository warning
                  {snapshot.warnings.length > 1 ? "s" : ""}
                </summary>
                {snapshot.warnings.map((w) => (
                  <p key={w}>{w}</p>
                ))}
              </details>
            )}
            {view === "wiki" && (
              <div className="wiki-layout">
                <aside className="page-tree">
                  <div className="panel-label">
                    PAGES<span>{flatWiki(snapshot.wiki).length}</span>
                  </div>
                  <WikiTree
                    nodes={filteredWiki(snapshot.wiki)}
                    selected={file?.path ?? group?.directory ?? ""}
                    onOpen={openWiki}
                  />
                  {snapshot.wiki.length === 0 && (
                    <div className="tree-empty">
                      No pages yet.
                      <br />
                      Create your first page.
                    </div>
                  )}
                  <div className="tree-foot">
                    <Folder size={12} />
                    {snapshot.settings.wikiRoot}/
                  </div>
                </aside>
                <section className="document-panel">
                  {file ? (
                    <>
                      <div className="document-toolbar">
                        <span>
                          <FileText size={14} />
                          {file.path}
                          {dirty && <i className="dirty-dot" />}
                        </span>
                        <div>
                          <button
                            className={
                              "button small " + (!editing ? "selected" : "")
                            }
                            onClick={() => setEditing(false)}
                          >
                            <Eye size={14} />
                            Read
                          </button>
                          <button
                            className={
                              "button small " + (editing ? "selected" : "")
                            }
                            onClick={() => setEditing(true)}
                          >
                            <Pencil size={13} />
                            Edit
                          </button>
                          {dirty && (
                            <button
                              className="button small primary"
                              disabled={busy}
                              onClick={() => void saveFile()}
                            >
                              <Save size={14} />
                              Save
                            </button>
                          )}
                        </div>
                      </div>
                      {editing ? (
                        <div className="editor-container">
                          <SourceEditor
                            path={file.path}
                            value={draft}
                            onChange={setDraft}
                          />
                        </div>
                      ) : (
                        <article className="markdown">
                          {renderMarkdown(draft, file.path)}
                        </article>
                      )}
                    </>
                  ) : group ? (
                    <article className="markdown">
                      <div className="eyebrow">DIRECTORY</div>
                      <h1>{group.title}</h1>
                      <p>
                        This directory has no matching Markdown page. Its
                        subpages are listed below.
                      </p>
                      {group.children.map((n) => (
                        <button
                          className="page-card"
                          key={n.path ?? n.directory}
                          onClick={() => openWiki(n)}
                        >
                          <FileText size={18} />
                          {n.title}
                          <ChevronRight size={16} />
                        </button>
                      ))}
                    </article>
                  ) : (
                    <div className="empty">
                      <BookOpen size={36} />
                      <h2>Your project’s shared context</h2>
                      <p>Select a page to read, or start a new one.</p>
                      {snapshot.wiki.length > 0 && (
                        <button
                          className="button"
                          onClick={() => openWiki(snapshot.wiki[0])}
                        >
                          Open first page
                          <ArrowUpRight size={15} />
                        </button>
                      )}
                    </div>
                  )}
                </section>
              </div>
            )}
            {view === "tasks" && (
              <div className="board-wrap">
                <div className="board-meta">
                  <span>
                    <LayoutGrid size={14} />
                    {filteredTasks.length} tasks
                    <span className="separator">/</span>
                    {snapshot.settings.statuses.length} workflow states
                  </span>
                  <span className="muted">
                    <span className="tiny-dot" />
                    Drag cards to update status
                  </span>
                </div>
                <div className="board">
                  {[
                    ...snapshot.settings.statuses,
                    ...new Set(
                      snapshot.tasks
                        .map((t) => t.status)
                        .filter((s) => !snapshot.settings.statuses.includes(s)),
                    ),
                  ].map((status, index) => {
                    const cards = filteredTasks.filter(
                      (t) => t.status === status,
                    );
                    return (
                      <section
                        className="board-column"
                        key={status}
                        onDragOver={(e) => {
                          if (snapshot.settings.statuses.includes(status)) {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                          }
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          const value = snapshot.tasks.find(
                            (t) =>
                              t.path === e.dataTransfer.getData("text/plain"),
                          );
                          if (
                            value &&
                            snapshot.settings.statuses.includes(status)
                          )
                            void moveTask(value, status);
                        }}
                      >
                        <header>
                          <div>
                            <i
                              style={{
                                background: [
                                  "#98a2b3",
                                  "#568bdb",
                                  "#b187ca",
                                  "#239c85",
                                ][index % 4],
                              }}
                            />
                            <strong>{title(status)}</strong>
                            <span>{cards.length}</span>
                          </div>
                          <button
                            aria-label={"Add task to " + status}
                            disabled={
                              busy ||
                              !snapshot.settings.statuses.includes(status)
                            }
                            className="icon-button"
                            onClick={() => {
                              openTask();
                              setTaskForm((old) =>
                                old ? { ...old, status } : old,
                              );
                            }}
                          >
                            <Plus size={15} />
                          </button>
                        </header>
                        <div className="card-stack">
                          {cards.map((t) => (
                            <button
                              className="task-card"
                              key={t.path}
                              draggable={!busy}
                              onDragStart={(e) =>
                                e.dataTransfer.setData("text/plain", t.path)
                              }
                              onClick={() => openTask(t)}
                            >
                              <div className="task-id">
                                {t.id.includes("-") && t.id.startsWith("ATL")
                                  ? t.id
                                  : t.id.slice(0, 8)}
                                <MoreHorizontal size={14} />
                              </div>
                              <h3>{t.title}</h3>
                              <div className="task-labels">
                                {t.labels.map((l) => (
                                  <span key={l}>{l}</span>
                                ))}
                              </div>
                              <div className="task-card-footer">
                                <span className={"priority " + t.priority}>
                                  <i />
                                  {title(t.priority)}
                                </span>
                                {t.assignee ? (
                                  <span className="avatar" title={t.assignee}>
                                    {initials(t.assignee)}
                                  </span>
                                ) : (
                                  <span className="unassigned">Unassigned</span>
                                )}
                              </div>
                            </button>
                          ))}
                          {cards.length === 0 && (
                            <div className="empty-column">Drop a task here</div>
                          )}
                        </div>
                      </section>
                    );
                  })}
                </div>
              </div>
            )}
            {view === "code" && (
              <div className="code-layout">
                <aside className="page-tree">
                  <div className="panel-label">
                    EXPLORER<span>{snapshot.settings.name}</span>
                  </div>
                  <FileTree
                    nodes={filteredFiles(snapshot.files)}
                    selected={file?.path ?? ""}
                    onOpen={(p) => void openFile(p, true)}
                  />
                </aside>
                <section className="document-panel">
                  {file ? (
                    <>
                      <div className="document-toolbar">
                        <span>
                          <Code2 size={15} />
                          {file.path}
                          {dirty && <i className="dirty-dot" />}
                        </span>
                        <div>
                          <span className="muted">
                            {dirty ? "Unsaved changes" : "Saved to disk"}
                          </span>
                          <button
                            className="button small primary"
                            disabled={busy || !dirty}
                            onClick={() => void saveFile()}
                          >
                            <Save size={14} />
                            Save file
                          </button>
                        </div>
                      </div>
                      <div className="editor-container">
                        <SourceEditor
                          path={file.path}
                          value={draft}
                          onChange={setDraft}
                        />
                      </div>
                    </>
                  ) : (
                    <div className="empty">
                      <Code2 size={36} />
                      <h2>A closer look at your project</h2>
                      <p>
                        Choose a text file from the explorer to start editing.
                      </p>
                    </div>
                  )}
                </section>
              </div>
            )}
            {view === "git" && (
              <div className="git-layout">
                <div className="git-toolbar">
                  <div className="tabs">
                    <button
                      className={gitTab === "changes" ? "active" : ""}
                      onClick={() => {
                        setGitTab("changes");
                        setDiff(null);
                      }}
                    >
                      Changes<span>{snapshot.changes.length}</span>
                    </button>
                    <button
                      className={gitTab === "history" ? "active" : ""}
                      onClick={() => {
                        setGitTab("history");
                        setDiff(null);
                      }}
                    >
                      History & graph
                    </button>
                  </div>
                  <div className="remote-controls">
                    <select
                      aria-label="Remote"
                      value={remote}
                      onChange={(e) => setRemote(e.target.value)}
                      disabled={!snapshot.remotes.length}
                    >
                      {!snapshot.remotes.length && <option>No remote</option>}
                      {snapshot.remotes.map((r) => (
                        <option key={r.name}>{r.name}</option>
                      ))}
                    </select>
                    {(["fetch", "pull", "push"] as const).map((action) => (
                      <button
                        className="button small"
                        key={action}
                        disabled={busy || !remote}
                        onClick={() =>
                          void gitAction(() => api.sync(action, remote))
                        }
                      >
                        {action === "push" ? (
                          <Upload size={13} />
                        ) : (
                          <Download size={13} />
                        )}{" "}
                        {title(action)}
                      </button>
                    ))}
                  </div>
                </div>
                {gitTab === "changes" ? (
                  <div className="changes-layout">
                    <aside className="changes-panel">
                      <div className="commit-form">
                        <label>COMMIT MESSAGE</label>
                        <textarea
                          aria-label="Commit message"
                          placeholder="What changed, and why?"
                          value={message}
                          onChange={(e) => setMessage(e.target.value)}
                        />
                        <button
                          className="button primary"
                          disabled={
                            busy ||
                            !message.trim() ||
                            !snapshot.changes.some(
                              (c) => c.index !== " " && c.index !== "?",
                            )
                          }
                          onClick={() =>
                            void gitAction(async () => {
                              await api.commit(message);
                              setMessage("");
                              setNotice("Commit created");
                            })
                          }
                        >
                          <GitCommitHorizontal size={16} />
                          Commit staged changes
                        </button>
                      </div>
                      {[true, false].map((staged) => {
                        const changes = snapshot.changes.filter((c) =>
                          staged
                            ? c.index !== " " && c.index !== "?"
                            : c.worktree !== " ",
                        );
                        return (
                          <div className="change-group" key={String(staged)}>
                            <div className="panel-label">
                              {staged ? "STAGED" : "WORKING TREE"}
                              <span>{changes.length}</span>
                            </div>
                            {changes.map((c) => (
                              <div
                                key={c.path}
                                className={
                                  "change-row " +
                                  (diff?.path === c.path &&
                                  diffStaged === staged
                                    ? "active"
                                    : "")
                                }
                              >
                                <button
                                  onClick={() => void showDiff(c.path, staged)}
                                >
                                  <FileText size={14} />
                                  <span title={c.path}>{c.path}</span>
                                  <b
                                    className={
                                      "change-type " +
                                      (staged ? c.index : c.worktree)
                                    }
                                  >
                                    {(staged ? c.index : c.worktree) === "?"
                                      ? "U"
                                      : staged
                                        ? c.index
                                        : c.worktree}
                                  </b>
                                </button>
                                <button
                                  className="icon-button"
                                  aria-label={
                                    (staged ? "Unstage " : "Stage ") + c.path
                                  }
                                  disabled={busy}
                                  onClick={() =>
                                    void gitAction(() =>
                                      staged
                                        ? api.unstage(c.path)
                                        : api.stage(c.path),
                                    )
                                  }
                                >
                                  {staged ? (
                                    <X size={14} />
                                  ) : (
                                    <Plus size={14} />
                                  )}
                                </button>
                              </div>
                            ))}
                            {changes.length === 0 && (
                              <p className="no-changes">
                                {staged
                                  ? "No staged files"
                                  : "No unstaged changes"}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </aside>
                    <section className="diff-panel">
                      {diff ? (
                        <>
                          <div className="document-toolbar">
                            <span>
                              <FileText size={14} />
                              {diff.path}
                            </span>
                            <span className="muted">
                              {diffStaged
                                ? "HEAD → index"
                                : "Index → working tree"}
                            </span>
                          </div>
                          <div className="editor-container">
                            <SourceDiff diff={diff} />
                          </div>
                        </>
                      ) : (
                        <div className="empty">
                          <CheckCheck size={36} />
                          <h2>
                            {snapshot.changes.length
                              ? "Give your changes a second look"
                              : "A clean working tree"}
                          </h2>
                          <p>
                            {snapshot.changes.length
                              ? "Select a file to review its diff before committing."
                              : "Your files match the current commit."}
                          </p>
                        </div>
                      )}
                    </section>
                  </div>
                ) : (
                  <div className="history-layout">
                    <section className="history-panel">
                      <div className="panel-label">
                        COMMIT GRAPH
                        <span>Latest {snapshot.commits.length} · all refs</span>
                      </div>
                      <CommitGraph
                        commits={snapshot.commits}
                        selected={selectedCommit?.hash ?? null}
                        onSelect={(c) =>
                          void run(async () => {
                            setSelectedCommit(c);
                            setCommitFiles(await api.commitFiles(c.hash));
                            setDiff(null);
                          })
                        }
                      />
                      {snapshot.commits.length === 0 && (
                        <div className="empty">No commits yet.</div>
                      )}
                    </section>
                    <section className="commit-detail">
                      {selectedCommit ? (
                        <>
                          <div className="commit-detail-header">
                            <code>{selectedCommit.hash.slice(0, 12)}</code>
                            <h3>{selectedCommit.subject}</h3>
                            <p>
                              {selectedCommit.author} ·{" "}
                              {new Date(selectedCommit.date).toLocaleString()}
                            </p>
                            <span>
                              {selectedCommit.parents.length > 1
                                ? "Merge commit · "
                                : ""}
                              {commitFiles.length} changed files
                            </span>
                            <div className="commit-file-list">
                              {commitFiles.map((p) => (
                                <button
                                  key={p}
                                  className={diff?.path === p ? "active" : ""}
                                  onClick={() =>
                                    void showDiff(p, false, selectedCommit.hash)
                                  }
                                >
                                  <FileText size={13} />
                                  {p}
                                </button>
                              ))}
                            </div>
                          </div>
                          {diff && (
                            <div className="editor-container">
                              <SourceDiff diff={diff} />
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="empty">
                          <Network size={36} />
                          <h2>Follow the history</h2>
                          <p>
                            Select a commit to inspect its files and changes.
                          </p>
                        </div>
                      )}
                    </section>
                  </div>
                )}
              </div>
            )}
            {view === "settings" && settings && (
              <div className="settings-layout">
                <section className="settings-card">
                  <div className="settings-card-heading">
                    <Settings2 size={20} />
                    <div>
                      <h2>Repository conventions</h2>
                      <p>
                        Saved in <code>.gitdesk.yml</code> and shared through
                        Git.
                      </p>
                    </div>
                  </div>
                  <div className="form-grid">
                    <label>
                      Project name
                      <input
                        value={settings.name}
                        onChange={(e) =>
                          setSettings({ ...settings, name: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Wiki directory
                      <input
                        value={settings.wikiRoot}
                        onChange={(e) =>
                          setSettings({ ...settings, wikiRoot: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Wiki home page
                      <input
                        value={settings.wikiHome}
                        onChange={(e) =>
                          setSettings({ ...settings, wikiHome: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Tasks directory
                      <input
                        value={settings.taskRoot}
                        onChange={(e) =>
                          setSettings({ ...settings, taskRoot: e.target.value })
                        }
                      />
                    </label>
                    <label className="full">
                      Workflow states
                      <input
                        value={states}
                        onChange={(e) => setStates(e.target.value)}
                      />
                      <small>
                        Comma-separated, in board order. Existing task files are
                        not moved or rewritten.
                      </small>
                    </label>
                  </div>
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api.saveSettings(
                          {
                            ...settings,
                            statuses: states
                              .split(",")
                              .map((s) => s.trim())
                              .filter(Boolean),
                          },
                          settingsBaseHash,
                        );
                        const next = await refresh();
                        setSettingsBaseHash(next.settingsHash);
                        setNotice("Settings saved");
                      })
                    }
                  >
                    <Save size={15} />
                    Save settings
                  </button>
                </section>
                <section className="settings-card">
                  <div className="settings-card-heading">
                    <GitBranch size={20} />
                    <div>
                      <h2>Git remotes</h2>
                      <p>
                        GitHub, Bitbucket, GitLab, SSH servers, or local paths.
                      </p>
                    </div>
                  </div>
                  {snapshot.remotes.map((r) => (
                    <div className="remote-row" key={r.name}>
                      <strong>{r.name}</strong>
                      <code>{r.url}</code>
                      <button
                        className="icon-button"
                        aria-label={"Edit remote " + r.name}
                        onClick={() => {
                          setRemoteName(r.name);
                          setRemoteUrl(r.url);
                        }}
                      >
                        <Pencil size={14} />
                      </button>
                    </div>
                  ))}
                  <div className="form-grid">
                    <label>
                      Remote name
                      <input
                        value={remoteName}
                        onChange={(e) => setRemoteName(e.target.value)}
                      />
                    </label>
                    <label>
                      URL or local path
                      <input
                        value={remoteUrl}
                        onChange={(e) => setRemoteUrl(e.target.value)}
                        placeholder="git@github.com:team/project.git"
                      />
                    </label>
                  </div>
                  <button
                    className="button"
                    disabled={busy || !remoteUrl}
                    onClick={() =>
                      void run(async () => {
                        await api.setRemote(remoteName, remoteUrl);
                        await refresh();
                        setRemoteUrl("");
                        setNotice("Remote saved to Git configuration");
                      })
                    }
                  >
                    <Plus size={15} />
                    Add or update remote
                  </button>
                  <p className="form-note">
                    Uses your Git credential manager and SSH agent. Configure
                    credentials outside the app; network commands do not prompt
                    for a password.
                  </p>
                </section>
                <div className="settings-tip">
                  <BookOpen size={18} />
                  <p>
                    A parent wiki page is a sibling of its directory:{" "}
                    <code>Architecture.md</code> contains the page, while{" "}
                    <code>Architecture/</code> contains its subpages.
                  </p>
                </div>
              </div>
            )}
          </>
        )}
        {snapshot && (
          <footer className="statusbar">
            <span>
              <GitBranch size={12} />
              {snapshot.branch}
              <span className="separator">·</span>
              {snapshot.changes.length} changes
            </span>
            <span>
              {busy ? "Working…" : "All data stays in your repository"}
              <span className="local-dot" />
            </span>
          </footer>
        )}
      </main>
      {modal && (
        <Modal
          title={
            modal === "clone"
              ? "Clone a repository"
              : modal === "page"
                ? "Create a wiki page"
                : "Create a branch"
          }
          onClose={() => !busy && setModal(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitSimple();
            }}
          >
            <label>
              {modal === "clone"
                ? "Repository URL or local path"
                : modal === "page"
                  ? "Page path, relative to the wiki root"
                  : "Branch name"}
              <input
                autoFocus
                required
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={
                  modal === "clone"
                    ? "git@github.com:team/project.git"
                    : modal === "page"
                      ? "Architecture/Backend/Database"
                      : "feature/my-change"
                }
              />
            </label>
            <p className="form-note">
              {modal === "clone"
                ? "You’ll choose a parent folder. Authentication uses your existing Git setup."
                : modal === "page"
                  ? `The page will be created inside ${snapshot?.settings.wikiRoot}/. Use / for nested pages.`
                  : "Creates and switches to a local branch. The working tree must be clean."}
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="button"
                onClick={() => setModal(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                className="button primary"
                disabled={busy || !text.trim()}
              >
                {busy
                  ? "Working…"
                  : modal === "clone"
                    ? "Choose folder & clone"
                    : "Create"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {taskForm && (
        <Modal
          title={task ? "Edit task" : "Create a task"}
          wide
          onClose={() => !busy && setTaskForm(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void saveTask();
            }}
          >
            {task && (
              <div className="task-file-path">
                <FileText size={13} />
                {task.path}
              </div>
            )}
            <label>
              Title
              <input
                autoFocus
                required
                value={taskForm.title}
                onChange={(e) =>
                  setTaskForm({ ...taskForm, title: e.target.value })
                }
                placeholder="What needs to happen?"
              />
            </label>
            <div className="form-grid three">
              <label>
                Status
                <select
                  value={taskForm.status}
                  onChange={(e) =>
                    setTaskForm({ ...taskForm, status: e.target.value })
                  }
                >
                  {!snapshot!.settings.statuses.includes(taskForm.status) && (
                    <option>{taskForm.status}</option>
                  )}
                  {snapshot!.settings.statuses.map((s) => (
                    <option key={s} value={s}>
                      {title(s)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Priority
                <select
                  value={taskForm.priority}
                  onChange={(e) =>
                    setTaskForm({ ...taskForm, priority: e.target.value })
                  }
                >
                  {!["low", "medium", "high", "critical"].includes(
                    taskForm.priority,
                  ) && <option>{taskForm.priority}</option>}
                  {["low", "medium", "high", "critical"].map((s) => (
                    <option key={s} value={s}>
                      {title(s)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Assignee
                <input
                  value={taskForm.assignee}
                  onChange={(e) =>
                    setTaskForm({ ...taskForm, assignee: e.target.value })
                  }
                  placeholder="Unassigned"
                />
              </label>
            </div>
            <label>
              Labels
              <input
                value={labels}
                onChange={(e) => setLabels(e.target.value)}
                placeholder="backend, experience"
              />
            </label>
            <label>
              Description · Markdown
              <textarea
                className="task-body"
                value={taskForm.body}
                onChange={(e) =>
                  setTaskForm({ ...taskForm, body: e.target.value })
                }
                placeholder="Context, acceptance criteria, and links…"
              />
            </label>
            <div className="modal-actions">
              <span className="form-note">
                Saved as a Markdown file. Commit when ready.
              </span>
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => setTaskForm(null)}
              >
                Cancel
              </button>
              <button
                className="button primary"
                disabled={busy || !taskForm.title.trim()}
              >
                <Save size={14} />
                {task ? "Save task" : "Create task"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
