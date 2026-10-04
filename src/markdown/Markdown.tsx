import { createContext, memo, useContext, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { toText } from "hast-util-to-text";
import type { Element } from "hast";
import { Check, Copy, ImageOff } from "lucide-react";
import { api, errorMessage } from "../api";
import { Spinner } from "../components/controls";
import { remarkGitdesk, type GitdeskOptions } from "./remark-gitdesk";
import "./markdown.css";

export type LinkTarget =
  | { kind: "anchor"; id: string }
  | { kind: "external"; url: string }
  | { kind: "missing"; title: string }
  | { kind: "file"; path: string; anchor?: string };

/** Resolves a Markdown href against the file that contains it. */
export function resolveHref(from: string, href: string): LinkTarget {
  if (href.startsWith("#")) return { kind: "anchor", id: decodeURIComponent(href.slice(1)) };
  if (href.startsWith("gitdesk-missing:")) return { kind: "missing", title: decodeURIComponent(href.slice(16)) };
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) return { kind: "external", url: href };
  const [target, anchor] = href.split("#");
  let decoded = target;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    /* Keep the raw href. */
  }
  const base = decoded.startsWith("/") ? [] : from.split("/").slice(0, -1);
  for (const part of decoded.split("/")) {
    if (part === "..") base.pop();
    else if (part && part !== ".") base.push(part);
  }
  return { kind: "file", path: base.join("/"), anchor: anchor ? decodeURIComponent(anchor) : undefined };
}

const TaskItem = createContext<number | null>(null);

/** Keeps links to missing wiki pages; everything else gets the standard sanitizing. */
const urlTransform = (url: string) => (url.startsWith("gitdesk-missing:") ? url : defaultUrlTransform(url));

interface MarkdownProps extends GitdeskOptions {
  source: string;
  /** Repository-relative path of the document, for relative links and images. */
  path: string;
  onLink(target: LinkTarget): void;
  /** Makes task-list checkboxes clickable; receives the item's source offset. */
  onToggleTask?(offset: number): void;
  className?: string;
}

export const Markdown = memo(function Markdown({
  source,
  path,
  onLink,
  onToggleTask,
  subpages,
  pages,
  tasks,
  className = "",
}: MarkdownProps) {
  const remarkPlugins = useMemo(
    () => [remarkGfm, [remarkGitdesk, { subpages, pages, tasks }]] as any,
    [subpages, pages, tasks],
  );
  const components = useMemo<Components>(
    () => ({
      a: ({ href = "", children, node: _node, ...props }) => (
        <a
          {...props}
          href={href}
          className={href.startsWith("gitdesk-missing:") ? "md-missing" : (props as { className?: string }).className}
          title={href.startsWith("gitdesk-missing:") ? "Create this page" : /^https?:/.test(href) ? href : undefined}
          onClick={(e) => {
            e.preventDefault();
            const target = resolveHref(path, href);
            if (target.kind === "anchor")
              document.getElementById(target.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
            else onLink(target);
          }}
        >
          {children}
        </a>
      ),
      img: ({ src, alt }) => <RepoImage from={path} src={typeof src === "string" ? src : ""} alt={alt ?? ""} />,
      pre: ({ node, children }) => <CodeBlock node={node as Element}>{children}</CodeBlock>,
      li: ({ node, className: itemClass, children, ...props }) =>
        onToggleTask && itemClass?.includes("task-list-item") && node?.position ? (
          <TaskItem.Provider value={node.position.start.offset ?? null}>
            <li className={itemClass} {...props}>
              {children}
            </li>
          </TaskItem.Provider>
        ) : (
          <li className={itemClass} {...props}>
            {children}
          </li>
        ),
      input: ({ type, checked }) =>
        type === "checkbox" ? <Checkbox checked={!!checked} onToggle={onToggleTask} /> : null,
      table: ({ children }) => (
        <div className="md-table">
          <table>{children}</table>
        </div>
      ),
    }),
    [path, onLink, onToggleTask],
  );
  return (
    <div className={`markdown selectable ${className}`}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={[[rehypeHighlight, { plainText: ["mermaid", "plantuml", "puml", "text", "txt"] }]]}
        components={components}
        urlTransform={urlTransform}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
});

function Checkbox({ checked, onToggle }: { checked: boolean; onToggle?(offset: number): void }) {
  const offset = useContext(TaskItem);
  const interactive = onToggle && offset !== null;
  return (
    <span
      role="checkbox"
      aria-checked={checked}
      tabIndex={interactive ? 0 : -1}
      className={`md-check ${checked ? "is-checked" : ""} ${interactive ? "is-interactive" : ""}`}
      onClick={() => interactive && onToggle!(offset!)}
      onKeyDown={(e) => {
        if (interactive && (e.key === " " || e.key === "Enter")) {
          e.preventDefault();
          onToggle!(offset!);
        }
      }}
    >
      {checked && <Check size={11} strokeWidth={3} />}
    </span>
  );
}

/** Flips the first `[ ]`/`[x]` at or after `offset`. */
export function toggleTaskAt(source: string, offset: number) {
  const match = /\[( |x|X)\]/.exec(source.slice(offset));
  if (!match) return source;
  const at = offset + match.index + 1;
  return source.slice(0, at) + (match[1] === " " ? "x" : " ") + source.slice(at + 1);
}

function CodeBlock({ node, children }: { node: Element; children: ReactNode }) {
  const code = node.children.find((c): c is Element => c.type === "element" && c.tagName === "code");
  const classes = (code?.properties.className as string[] | undefined) ?? [];
  const language = classes.find((c) => c.startsWith("language-"))?.slice(9) ?? "";
  const text = code ? toText(code, { whitespace: "pre" }).replace(/\n$/, "") : "";
  const [copied, setCopied] = useState(false);
  if (language === "mermaid") return <Mermaid code={text} />;
  if (language === "plantuml" || language === "puml") return <PlantUml code={text} />;
  return (
    <div className="md-code">
      <div className="md-code-bar">
        <span>{language}</span>
        <button
          aria-label="Copy code"
          onClick={() => {
            void navigator.clipboard?.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

function DiagramError({ title, error, code }: { title: string; error: string; code: string }) {
  return (
    <div className="md-diagram-error">
      <strong>{title}</strong>
      <span>{error}</span>
      <pre>{code}</pre>
    </div>
  );
}

let mermaidModule: Promise<typeof import("mermaid").default> | null = null;
const light = () => matchMedia("(prefers-color-scheme: light)").matches;

function Mermaid({ code }: { code: string }) {
  const id = "mermaid-" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const [state, setState] = useState<{ svg?: string; error?: string }>({});
  useEffect(() => {
    let cancelled = false;
    (mermaidModule ??= import("mermaid").then((m) => m.default))
      .then(async (mermaid) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: light() ? "neutral" : "dark",
          fontFamily: "Inter Variable, sans-serif",
        });
        const { svg } = await mermaid.render(id, code);
        if (!cancelled) setState({ svg });
      })
      .catch((error) => !cancelled && setState({ error: errorMessage(error) }));
    return () => {
      cancelled = true;
    };
  }, [code, id]);
  if (state.error) return <DiagramError title="Mermaid diagram" error={state.error} code={code} />;
  if (!state.svg)
    return (
      <div className="md-diagram">
        <Spinner />
      </div>
    );
  return <div className="md-diagram" dangerouslySetInnerHTML={{ __html: state.svg }} />;
}

function PlantUml({ code }: { code: string }) {
  const [state, setState] = useState<{ svg?: string; error?: string }>({});
  useEffect(() => {
    let cancelled = false;
    api()
      .plantuml(code)
      .then((svg) => !cancelled && setState({ svg }))
      .catch((error) => !cancelled && setState({ error: errorMessage(error) }));
    return () => {
      cancelled = true;
    };
  }, [code]);
  if (state.error) return <DiagramError title="PlantUML diagram" error={state.error} code={code} />;
  return (
    <div className="md-diagram">
      {state.svg ? (
        <img alt="PlantUML diagram" src={"data:image/svg+xml;charset=utf-8," + encodeURIComponent(state.svg)} />
      ) : (
        <Spinner />
      )}
    </div>
  );
}

/** Repository images load through the engine; remote images never load implicitly. */
function RepoImage({ from, src, alt }: { from: string; src: string; alt: string }) {
  const target = resolveHref(from, src);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (target.kind !== "file") return;
    let cancelled = false;
    setFailed(false);
    api()
      .image("content", target.path)
      .then((data) => !cancelled && setUrl(data))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [target.kind === "file" ? target.path : src]);
  if (target.kind === "external")
    return (
      <a className="md-remote-image" href={src} onClick={(e) => (e.preventDefault(), void api().openExternal(src))}>
        <ImageOff size={14} /> {alt || "Remote image"}
      </a>
    );
  if (failed)
    return (
      <span className="md-remote-image">
        <ImageOff size={14} /> {alt || src}
      </span>
    );
  return url ? <img src={url} alt={alt} /> : null;
}
