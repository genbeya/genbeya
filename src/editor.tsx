import Editor, { DiffEditor, loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import CssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import TsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import { useEffect, useRef } from "react";
import type { Diff } from "../shared/types";
(self as any).MonacoEnvironment = {
  getWorker(_: string, label: string) {
    if (label === "json") return new JsonWorker();
    if (["css", "scss", "less"].includes(label)) return new CssWorker();
    if (["html", "handlebars", "razor"].includes(label))
      return new HtmlWorker();
    if (["typescript", "javascript"].includes(label)) return new TsWorker();
    return new EditorWorker();
  },
};
loader.config({ monaco });
const language = (p: string) =>
  ({
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    md: "markdown",
    yml: "yaml",
    yaml: "yaml",
    css: "css",
    html: "html",
    py: "python",
    rs: "rust",
    go: "go",
    sh: "shell",
    sql: "sql",
    java: "java",
  })[p.split(".").pop() ?? ""] ?? "plaintext";
const options: monaco.editor.IStandaloneEditorConstructionOptions = {
  fontSize: 13,
  fontFamily: '"SFMono-Regular", Consolas, monospace',
  lineHeight: 23,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  automaticLayout: true,
  padding: { top: 18, bottom: 18 },
  wordWrap: "on",
  renderLineHighlight: "gutter",
};
export function SourceEditor({
  path,
  value,
  onChange,
  onSave,
}: {
  path: string;
  value: string;
  onChange: (v: string) => void;
  onSave?: () => void;
}) {
  // Monaco swallows handled keys, so Ctrl/Cmd+S is bound inside the editor too.
  const save = useRef(onSave);
  useEffect(() => {
    save.current = onSave;
  });
  return (
    <Editor
      path={path}
      language={language(path)}
      value={value}
      onChange={(v) => onChange(v ?? "")}
      onMount={(editor) =>
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
          save.current?.(),
        )
      }
      theme="vs"
      options={options}
      loading={<div className="empty">Loading editor…</div>}
    />
  );
}
export function SourceDiff({ diff }: { diff: Diff }) {
  return (
    <DiffEditor
      original={diff.original}
      modified={diff.modified}
      language={language(diff.path)}
      theme="vs"
      options={{ ...options, readOnly: true, renderSideBySide: true }}
      loading={<div className="empty">Loading diff…</div>}
    />
  );
}
