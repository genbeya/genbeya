import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  ChevronRight,
  Columns2,
  Ellipsis,
  FilePlus2,
  FileText,
  Folder,
  FolderInput,
  Pencil,
  Plus,
  Search,
  Trash2,
  Code2,
  Copy,
} from "lucide-react";
import type { WikiNode } from "../../../shared/api";
import { api } from "../../api";
import { modKey, useHotkey } from "../../app/hotkeys";
import { useRouter } from "../../app/router";
import { stripFrontmatter, useFile } from "../../app/useFile";
import { useWorkspace } from "../../app/workspace";
import { Button, EmptyState, IconButton } from "../../components/controls";
import { Menu, type MenuItem } from "../../components/Menu";
import { usePanelWidth } from "../../components/Resizer";
import { useToast } from "../../components/Toasts";
import { filterTree, Tree, type TreeItem } from "../../components/Tree";
import { SourceEditor } from "../../editor/Editor";
import { Markdown } from "../../markdown/Markdown";
import type { PageRef } from "../../markdown/remark-gitdesk";
import { findPage, flattenPages, useLinkTargets, useWikiActions } from "./actions";
import "./wiki.css";

const keyOf = (n: WikiNode) => n.path ?? "dir:" + n.dir;

const toRefs = (nodes: WikiNode[]): PageRef[] =>
  nodes.map((n) => ({ title: n.title, path: n.path ?? (n.dir ?? "") + ".md", children: toRefs(n.children) }));

export function WikiView() {
  const { snapshot } = useWorkspace();
  const { route, navigate } = useRouter();
  const wiki = useWikiActions();
  const { wikiRoot, wikiHome } = snapshot.settings;
  const r = route.view === "wiki" ? route : { view: "wiki" as const };
  const home = `${wikiRoot}/${wikiHome}`;
  const homeExists = !!findPage(snapshot.wiki, home)?.node.path;

  useEffect(() => {
    if (!r.page && !r.dir) {
      const first = homeExists ? home : flattenPages(snapshot.wiki)[0]?.path;
      if (first) navigate({ view: "wiki", page: first }, { replace: true });
    }
  }, [r.page, r.dir, homeExists]);

  useHotkey("n", () => void wiki.createPage(r.page && findPage(snapshot.wiki, r.page)?.node.path ? r.page : undefined));
  const { width, handle } = usePanelWidth("wiki-tree", 256);

  return (
    <div className="view">
      <div className="view-body">
        <aside className="side-panel" style={{ width }}>
          <PageTree selected={r.page ?? (r.dir ? "dir:" + r.dir : null)} />
        </aside>
        {handle}
        <section className="wiki-main">
          {r.page ? (
            <Page key={r.page} path={r.page} anchor={r.anchor} />
          ) : r.dir ? (
            <FolderPage dir={r.dir} />
          ) : (
            <EmptyState icon={<BookOpen size={20} />} title="No pages yet">
              <p>Pages are Markdown files in {wikiRoot}/. Start with a home page.</p>
              <Button variant="primary" icon={<Plus size={14} />} onClick={() => void api().createPage(home).then((f) => navigate({ view: "wiki", page: f.path }))}>
                Create home page
              </Button>
            </EmptyState>
          )}
        </section>
      </div>
    </div>
  );
}

function PageTree({ selected }: { selected: string | null }) {
  const { snapshot } = useWorkspace();
  const { navigate } = useRouter();
  const wiki = useWikiActions();
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useHotkey("/", () => input.current?.focus());

  const items = useMemo(() => {
    const convert = (nodes: WikiNode[]): TreeItem[] =>
      nodes.map((n) => ({
        key: keyOf(n),
        label: n.title,
        icon: n.path ? <FileText size={14} /> : <Folder size={14} />,
        children: convert(n.children),
        actions: (
          <>
            <IconButton label={`New page in ${n.title}`} onClick={() => void wiki.createPage(n.path ?? n.dir + ".md")}>
              <Plus size={13} />
            </IconButton>
            {n.path && <PageMenu path={n.path} />}
          </>
        ),
      }));
    return convert(snapshot.wiki);
  }, [snapshot.wiki, wiki]);

  const shown = filterTree(items, query);
  return (
    <>
      <div className="row wiki-tree-top">
        <label className="filter grow">
          <Search size={13} />
          <input
            ref={input}
            value={query}
            placeholder="Filter pages"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && (setQuery(""), input.current?.blur())}
          />
        </label>
        <IconButton label="New page (N)" onClick={() => void wiki.createPage()}>
          <FilePlus2 size={15} />
        </IconButton>
      </div>
      <div className="side-panel-scroll">
        <Tree
          label="Pages"
          items={shown}
          selected={selected}
          expandAll={!!query}
          initiallyExpanded={(item) => !item.key.includes("/", snapshot.settings.wikiRoot.length + 1)}
          onSelect={(item) =>
            item.key.startsWith("dir:")
              ? navigate({ view: "wiki", dir: item.key.slice(4) })
              : navigate({ view: "wiki", page: item.key })
          }
        />
        {query && !shown.length && <p className="tree-empty">No pages match.</p>}
      </div>
    </>
  );
}

function PageMenu({ path, button }: { path: string; button?: boolean }) {
  const wiki = useWikiActions();
  const { navigate } = useRouter();
  const toast = useToast();
  const items: MenuItem[] = [
    { label: "New subpage", icon: <Plus size={14} />, onSelect: () => void wiki.createPage(path) },
    { label: "Move or rename…", icon: <FolderInput size={14} />, onSelect: () => void wiki.movePage(path) },
    { label: "Copy path", icon: <Copy size={14} />, onSelect: () => (void navigator.clipboard?.writeText(path), toast.success("Path copied")) },
    { label: "Open in code editor", icon: <Code2 size={14} />, onSelect: () => navigate({ view: "code", file: path }) },
    "separator",
    { label: "Delete page…", icon: <Trash2 size={14} />, danger: true, onSelect: () => void wiki.deletePage(path) },
  ];
  return (
    <Menu
      items={items}
      align="end"
      trigger={({ toggle, ref, open }) => (
        <IconButton ref={ref} label="Page actions" active={open} onClick={toggle} className={button ? "" : "tree-menu"}>
          <Ellipsis size={button ? 16 : 13} />
        </IconButton>
      )}
    />
  );
}

function Breadcrumbs({ path }: { path: string }) {
  const { snapshot } = useWorkspace();
  const { navigate } = useRouter();
  const found = findPage(snapshot.wiki, path);
  const trail = found?.trail ?? [];
  return (
    <div className="view-title">
      {trail.map((n) => (
        <span key={keyOf(n)} className="row" style={{ gap: 6 }}>
          <button
            className="crumb plain"
            onClick={() => navigate(n.path ? { view: "wiki", page: n.path } : { view: "wiki", dir: n.dir! })}
          >
            {n.title}
          </button>
          <ChevronRight size={13} className="crumb-sep" />
        </span>
      ))}
      <span className="ellipsis">{found?.node.title ?? path.split("/").pop()!.replace(/\.md$/, "")}</span>
    </div>
  );
}

function Page({ path, anchor }: { path: string; anchor?: string }) {
  const { snapshot, run, contentChanged } = useWorkspace();
  const router = useRouter();
  const wiki = useWikiActions();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [preview, setPreview] = useState(true);
  const { file, setFile, error, changedOnDisk, reload } = useFile("content", path, editing);
  const dirty = editing && !!file && draft !== file.content;
  const article = useRef<HTMLDivElement>(null);

  useEffect(() => router.setDirty("wiki-page", dirty), [dirty]);
  useEffect(() => () => router.setDirty("wiki-page", false), []);

  const found = findPage(snapshot.wiki, path);
  const subpages = useMemo(() => toRefs(found?.node.children ?? []), [found?.node.children]);
  const { pages, tasks } = useLinkTargets();

  const edit = () => {
    if (!file) return;
    setDraft(file.content);
    setEditing(true);
  };
  const saving = useRef(false);
  const save = useCallback(
    async (close: boolean) => {
      if (!file || saving.current) return;
      if (draft !== file.content) {
        saving.current = true;
        const saved = await run(() => api().write("content", path, draft, file.hash));
        saving.current = false;
        if (!saved) return;
        setFile(saved);
        contentChanged();
      }
      if (close) setEditing(false);
    },
    [file, draft, path, run, contentChanged, setFile],
  );
  const cancel = () => {
    if (dirty && !window.confirm("Discard your changes to this page?")) return;
    setEditing(false);
  };

  useHotkey("e", edit, !editing && !!file);
  useHotkey("mod+s", () => void save(false), editing);
  useHotkey("escape", cancel, editing);

  useLayoutEffect(() => {
    if (anchor && file && !editing)
      document.getElementById(anchor)?.scrollIntoView({ block: "start" });
  }, [anchor, !!file, editing]);

  if (error)
    return (
      <EmptyState icon={<FileText size={20} />} title="This page does not exist">
        <p className="selectable">{path}</p>
        <Button variant="primary" icon={<Plus size={14} />} onClick={() => void run(() => api().createPage(path)).then((f) => f && (contentChanged(), reload()))}>
          Create it
        </Button>
      </EmptyState>
    );

  return (
    <div className="view">
      <header className="view-header">
        <Breadcrumbs path={path} />
        {dirty && <span className="dirty-dot" title="Unsaved changes" />}
        <span className="grow" />
        {editing ? (
          <>
            <IconButton label="Toggle preview" active={preview} onClick={() => setPreview((p) => !p)}>
              <Columns2 size={15} />
            </IconButton>
            <Button variant="ghost" onClick={cancel}>
              Cancel
            </Button>
            <Button variant="primary" shortcut={`${modKey} S`} onClick={() => void save(true)}>
              Save
            </Button>
          </>
        ) : (
          <>
            <Button icon={<Pencil size={13} />} shortcut="E" onClick={edit} disabled={!file}>
              Edit
            </Button>
            <PageMenu path={path} button />
          </>
        )}
      </header>
      {changedOnDisk && (
        <div className="banner">
          This page changed on disk while you were editing.
          <Button size="s" onClick={() => (void reload(), setEditing(false))}>
            Discard mine and reload
          </Button>
        </div>
      )}
      {editing && file ? (
        <div className={`wiki-editor ${preview ? "with-preview" : ""}`}>
          <SourceEditor path={path} value={draft} onChange={setDraft} onSave={() => void save(false)} lineNumbers={false} autoFocus />
          {preview && <Preview source={draft} path={path} subpages={subpages} />}
        </div>
      ) : (
        <div className="content-scroll" ref={article}>
          {file && (
            <div className="wiki-page">
              <article className="wiki-article">
                <Markdown
                  source={stripFrontmatter(file.content)}
                  path={path}
                  subpages={subpages}
                  pages={pages}
                  tasks={tasks}
                  onLink={wiki.followLink}
                />
              </article>
              <Outline container={article} source={file.content} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Preview(props: { source: string; path: string; subpages: PageRef[] }) {
  const wiki = useWikiActions();
  const { pages, tasks } = useLinkTargets();
  const source = useDeferredValue(props.source);
  return (
    <div className="wiki-preview content-scroll">
      <Markdown
        source={stripFrontmatter(source)}
        path={props.path}
        subpages={props.subpages}
        pages={pages}
        tasks={tasks}
        onLink={wiki.followLink}
      />
    </div>
  );
}

/** "On this page": h2/h3 headings of the rendered article, highlighting the current one. */
function Outline({ container, source }: { container: React.RefObject<HTMLDivElement | null>; source: string }) {
  const [headings, setHeadings] = useState<{ id: string; text: string; level: number }[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    setHeadings(
      [...root.querySelectorAll<HTMLElement>(".wiki-article h2[id], .wiki-article h3[id]")].map((h) => ({
        id: h.id,
        text: h.textContent ?? "",
        level: h.tagName === "H2" ? 2 : 3,
      })),
    );
  }, [source, container]);
  useEffect(() => {
    const root = container.current;
    if (!root || headings.length < 3) return;
    const scroll = () => {
      let active: string | null = headings[0]?.id ?? null;
      for (const h of headings) {
        const element = document.getElementById(h.id);
        if (element && element.getBoundingClientRect().top - root.getBoundingClientRect().top < 80) active = h.id;
      }
      setCurrent(active);
    };
    scroll();
    root.addEventListener("scroll", scroll, { passive: true });
    return () => root.removeEventListener("scroll", scroll);
  }, [headings, container]);
  if (headings.length < 3) return <div className="wiki-outline" />;
  return (
    <nav className="wiki-outline" aria-label="On this page">
      <div className="wiki-outline-inner">
        <div className="outline-title">On this page</div>
        {headings.map((h) => (
          <button
            key={h.id}
            className={`outline-item level-${h.level} ${current === h.id ? "is-current" : ""}`}
            onClick={() => document.getElementById(h.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
          >
            {h.text}
          </button>
        ))}
      </div>
    </nav>
  );
}

function FolderPage({ dir }: { dir: string }) {
  const { snapshot, run, contentChanged } = useWorkspace();
  const { navigate } = useRouter();
  const found = findPage(snapshot.wiki, dir);
  if (!found) return <EmptyState icon={<Folder size={20} />} title="This folder has no pages" />;
  const { node } = found;
  const create = async () => {
    const page = await run(() => api().createPage(dir + ".md"));
    if (page) {
      contentChanged();
      navigate({ view: "wiki", page: page.path }, { replace: true });
    }
  };
  return (
    <div className="view">
      <header className="view-header">
        <Breadcrumbs path={dir} />
        <span className="grow" />
        <Button icon={<FilePlus2 size={14} />} onClick={() => void create()}>
          Write an overview page
        </Button>
      </header>
      <div className="content-scroll">
        <div className="wiki-page">
          <div className="wiki-article">
            <h1 className="folder-title">{node.title}</h1>
            <div className="folder-list">
              {node.children.map((child) => (
                <button
                  key={keyOf(child)}
                  className="folder-card"
                  onClick={() => navigate(child.path ? { view: "wiki", page: child.path } : { view: "wiki", dir: child.dir! })}
                >
                  {child.path ? <FileText size={16} /> : <Folder size={16} />}
                  <span className="grow">{child.title}</span>
                  {child.children.length > 0 && <span className="faint">{child.children.length} pages</span>}
                  <ChevronRight size={14} className="faint" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
