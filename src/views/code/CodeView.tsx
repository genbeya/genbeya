import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Code2, Copy, Ellipsis, Eye, File, FileDiff, FilePlus2, Folder, Pencil, Search, Trash2 } from "lucide-react";
import type { FileNode } from "../../../shared/api";
import { api } from "../../api";
import { modKey, useHotkey } from "../../app/hotkeys";
import { useRouter } from "../../app/router";
import { useFile } from "../../app/useFile";
import { useWorkspace } from "../../app/workspace";
import { Button, EmptyState, IconButton } from "../../components/controls";
import { useDialogs } from "../../components/Dialog";
import { Menu } from "../../components/Menu";
import { usePanelWidth } from "../../components/Resizer";
import { useToast } from "../../components/Toasts";
import { filterTree, Tree, type TreeItem } from "../../components/Tree";
import { SourceEditor } from "../../editor/Editor";
import { Markdown } from "../../markdown/Markdown";
import { useWikiActions } from "../wiki/actions";
import "./code.css";

export function CodeView() {
  const { snapshot, run } = useWorkspace();
  const { route, navigate } = useRouter();
  const dialogs = useDialogs();
  const file = route.view === "code" ? route.file : undefined;

  const createFile = async () => {
    const folder = file?.includes("/") ? file.slice(0, file.lastIndexOf("/") + 1) : "";
    const path = await dialogs.prompt({
      title: "New file",
      label: "Path",
      initial: folder,
      placeholder: "src/new-file.ts",
      confirm: "Create",
      hint: "Relative to the repository root. Folders are created as needed.",
    });
    if (!path) return;
    const created = await run(() => api().write("repo", path.replace(/^\/+/, ""), "", null));
    if (created) navigate({ view: "code", file: created.path });
  };
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const { width, handle } = usePanelWidth("code-tree", 270);
  useHotkey("/", () => input.current?.focus());

  const status = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of snapshot.changes) map.set(c.path, c.index === "?" ? "U" : c.worktree !== " " ? c.worktree : c.index);
    return map;
  }, [snapshot.changes]);

  const items = useMemo(() => {
    const convert = (nodes: FileNode[]): TreeItem[] =>
      nodes.map((n) => ({
        key: n.path,
        label: n.name,
        icon: n.children ? <Folder size={14} /> : <File size={14} />,
        children: n.children ? convert(n.children) : undefined,
        selectable: !n.children,
        actions: status.has(n.path) ? <span className={`status-letter ${status.get(n.path)}`}>{status.get(n.path)}</span> : undefined,
      }));
    return convert(snapshot.files);
  }, [snapshot.files, status]);
  const shown = filterTree(items, query);

  return (
    <div className="view">
      <div className="view-body">
        <aside className="side-panel" style={{ width }}>
          <div className="row wiki-tree-top">
            <label className="filter grow">
              <Search size={13} />
              <input
                ref={input}
                value={query}
                placeholder="Filter files"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && (setQuery(""), input.current?.blur())}
              />
            </label>
            <IconButton label="New file" onClick={() => void createFile()}>
              <FilePlus2 size={15} />
            </IconButton>
          </div>
          <div className="side-panel-scroll code-tree">
            <Tree
              label="Files"
              items={shown}
              selected={file ?? null}
              expandAll={!!query}
              onSelect={(item) => navigate({ view: "code", file: item.key })}
            />
          </div>
        </aside>
        {handle}
        <section className="wiki-main">
          {file ? (
            <FileEditor key={file} path={file} changed={status.has(file)} />
          ) : (
            <EmptyState icon={<Code2 size={20} />} title="Open a file">
              <p>
                Pick one from the tree, or press {modKey}+P to search.
              </p>
            </EmptyState>
          )}
        </section>
      </div>
    </div>
  );
}

function FileEditor({ path, changed }: { path: string; changed: boolean }) {
  const { run } = useWorkspace();
  const router = useRouter();
  const toast = useToast();
  const dialogs = useDialogs();
  const remove = async () => {
    const ok = await dialogs.confirm({
      title: "Delete file",
      message: `Delete ${path} from the working tree? Committed versions stay in Git history.`,
      confirm: "Delete",
      danger: true,
    });
    if (ok && (await run(() => api().remove("repo", path).then(() => true), "File deleted"))) {
      router.setDirty("code", false);
      router.navigate({ view: "code" }, { replace: true });
    }
  };
  const wiki = useWikiActions();
  const [draft, setDraft] = useState<string | null>(null);
  const markdown = /\.(md|markdown)$/i.test(path);
  const [preview, setPreview] = useState(false);
  const { file, setFile, error, changedOnDisk, reload } = useFile("repo", path, draft !== null);
  const value = draft ?? file?.content ?? "";
  const dirty = !!file && draft !== null && draft !== file.content;

  useEffect(() => router.setDirty("code", dirty), [dirty]);
  useEffect(() => () => router.setDirty("code", false), []);

  const saving = useRef(false);
  const save = async () => {
    if (!file || !dirty || saving.current) return;
    saving.current = true;
    const content = draft!;
    const saved = await run(() => api().write("repo", path, content, file.hash));
    saving.current = false;
    if (saved) {
      setFile(saved);
      // Keep anything typed while the save was in flight.
      setDraft((current) => (current === saved.content ? null : current));
    }
  };
  useHotkey("mod+s", () => void save());

  const segments = path.split("/");
  return (
    <div className="view">
      <header className="view-header">
        <div className="view-title code-path">
          {segments.slice(0, -1).map((s, i) => (
            <span key={i} className="row" style={{ gap: 4 }}>
              <span className="crumb">{s}</span>
              <ChevronRight size={12} className="crumb-sep" />
            </span>
          ))}
          <span>{segments.at(-1)}</span>
        </div>
        {dirty && <span className="dirty-dot" title="Unsaved changes" />}
        <span className="grow" />
        {markdown && (
          <div className="segmented">
            <button className={!preview ? "is-active" : ""} onClick={() => setPreview(false)}>
              <Pencil size={12} /> Edit
            </button>
            <button className={preview ? "is-active" : ""} onClick={() => setPreview(true)}>
              <Eye size={12} /> Preview
            </button>
          </div>
        )}
        <Button variant={dirty ? "primary" : "default"} disabled={!dirty} shortcut={`${modKey} S`} onClick={() => void save()}>
          Save
        </Button>
        <Menu
          align="end"
          items={[
            { label: "Copy path", icon: <Copy size={14} />, onSelect: () => (void navigator.clipboard?.writeText(path), toast.success("Path copied")) },
            { label: "Show changes", icon: <FileDiff size={14} />, disabled: !changed, onSelect: () => router.navigate({ view: "changes", file: path }) },
            "separator",
            { label: "Delete file…", icon: <Trash2 size={14} />, danger: true, onSelect: () => void remove() },
          ]}
          trigger={({ toggle, ref, open }) => (
            <IconButton ref={ref} label="File actions" active={open} onClick={toggle}>
              <Ellipsis size={16} />
            </IconButton>
          )}
        />
      </header>
      {changedOnDisk && (
        <div className="banner">
          This file changed on disk.
          <Button size="s" onClick={() => (setDraft(null), void reload())}>
            Discard mine and reload
          </Button>
        </div>
      )}
      {error ? (
        <EmptyState icon={<File size={20} />} title="Can't open this file">
          <p className="selectable">{error}</p>
        </EmptyState>
      ) : file && preview ? (
        <div className="content-scroll">
          <div className="wiki-page">
            <article className="wiki-article">
              <Markdown source={value} path={path} onLink={wiki.followLink} />
            </article>
          </div>
        </div>
      ) : file ? (
        <SourceEditor path={path} value={value} onChange={setDraft} onSave={() => void save()} />
      ) : null}
    </div>
  );
}
