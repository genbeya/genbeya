import { useEffect, useRef, useState } from "react";
import MonacoEditor, { DiffEditor as MonacoDiffEditor } from "@monaco-editor/react";
import { languageOf, monaco } from "./monaco";
import { Spinner } from "../components/controls";
import "./Editor.css";

function useMonacoTheme() {
  const query = "(prefers-color-scheme: light)";
  const [light, setLight] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const media = matchMedia(query);
    const change = () => setLight(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  return light ? "gitdesk-light" : "gitdesk-dark";
}

const OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
  fontFamily: '"JetBrains Mono Variable", Consolas, monospace',
  fontSize: 13,
  lineHeight: 21,
  fontLigatures: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  automaticLayout: true,
  padding: { top: 14, bottom: 14 },
  renderLineHighlight: "line",
  smoothScrolling: true,
  scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
  overviewRulerBorder: false,
  stickyScroll: { enabled: false },
};

const loading = (
  <div className="editor-loading">
    <Spinner />
  </div>
);

export function SourceEditor({
  path,
  value,
  onChange,
  onSave,
  wordWrap,
  lineNumbers = true,
  readOnly = false,
  autoFocus = false,
}: {
  path: string;
  value: string;
  onChange(value: string): void;
  onSave?(): void;
  wordWrap?: boolean;
  lineNumbers?: boolean;
  readOnly?: boolean;
  autoFocus?: boolean;
}) {
  const theme = useMonacoTheme();
  // Monaco consumes Ctrl+S inside the editor, so it is bound there as well.
  const save = useRef(onSave);
  save.current = onSave;
  const language = languageOf(path);
  return (
    <div className="editor">
      <MonacoEditor
        path={path}
        language={language}
        value={value}
        theme={theme}
        loading={loading}
        onChange={(v) => onChange(v ?? "")}
        onMount={(editor) => {
          editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => save.current?.());
          if (autoFocus) editor.focus();
        }}
        options={{
          ...OPTIONS,
          readOnly,
          wordWrap: wordWrap ?? language === "markdown" ? "on" : "off",
          lineNumbers: lineNumbers ? "on" : "off",
          ...(lineNumbers ? {} : { glyphMargin: false, folding: false, lineDecorationsWidth: 0, lineNumbersMinChars: 0 }),
        }}
      />
    </div>
  );
}

export function DiffEditor({
  path,
  original,
  modified,
  inline,
}: {
  path: string;
  original: string;
  modified: string;
  inline: boolean;
}) {
  const theme = useMonacoTheme();
  return (
    <div className="editor">
      <MonacoDiffEditor
        original={original}
        modified={modified}
        language={languageOf(path)}
        theme={theme}
        loading={loading}
        options={{
          ...OPTIONS,
          readOnly: true,
          renderSideBySide: !inline,
          useInlineViewWhenSpaceIsLimited: true,
          hideUnchangedRegions: { enabled: true, contextLineCount: 4 },
          renderOverviewRuler: false,
        }}
      />
    </div>
  );
}
