import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import CssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import TsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

// Bundled workers: the editor works offline and under the app's CSP.
self.MonacoEnvironment = {
  getWorker(_: string, label: string) {
    if (label === "json") return new JsonWorker();
    if (["css", "scss", "less"].includes(label)) return new CssWorker();
    if (["html", "handlebars", "razor"].includes(label)) return new HtmlWorker();
    if (["typescript", "javascript"].includes(label)) return new TsWorker();
    return new EditorWorker();
  },
};
loader.config({ monaco });

// Without the project's compiler setup every import looks unresolved; keep
// syntax errors, drop type checking.
for (const defaults of [monaco.typescript.typescriptDefaults, monaco.typescript.javascriptDefaults])
  defaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });

monaco.editor.defineTheme("gitdesk-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "6f707a", fontStyle: "italic" },
    { token: "keyword", foreground: "a9abff" },
    { token: "string", foreground: "8fd1a8" },
    { token: "number", foreground: "e8a46a" },
    { token: "type", foreground: "7cc4e8" },
  ],
  colors: {
    "editor.background": "#16171a",
    "editor.lineHighlightBackground": "#1d1e22",
    "editorLineNumber.foreground": "#4a4b53",
    "editorLineNumber.activeForeground": "#a2a3ab",
    "editorGutter.background": "#16171a",
    "editor.selectionBackground": "#7c7ff240",
    "editorIndentGuide.background1": "#25262b",
    "editorWidget.background": "#202126",
    "diffEditor.insertedTextBackground": "#4cb78222",
    "diffEditor.removedTextBackground": "#ec6a6a22",
    "diffEditor.insertedLineBackground": "#4cb78214",
    "diffEditor.removedLineBackground": "#ec6a6a14",
    "scrollbarSlider.background": "#ffffff14",
  },
});

monaco.editor.defineTheme("gitdesk-light", {
  base: "vs",
  inherit: true,
  rules: [
    { token: "comment", foreground: "8d8e97", fontStyle: "italic" },
    { token: "keyword", foreground: "4b4fd4" },
    { token: "string", foreground: "1f8a55" },
  ],
  colors: {
    "editor.background": "#ffffff",
    "editor.lineHighlightBackground": "#f6f6f8",
    "editorLineNumber.foreground": "#c4c5cc",
    "editorLineNumber.activeForeground": "#5f6069",
    "editor.selectionBackground": "#5b5fe030",
    "diffEditor.insertedTextBackground": "#2a9a6322",
    "diffEditor.removedTextBackground": "#d6454522",
    "diffEditor.insertedLineBackground": "#2a9a6310",
    "diffEditor.removedLineBackground": "#d6454510",
  },
});

export { monaco };

const LANGUAGES: Record<string, string> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  json: "json", md: "markdown", markdown: "markdown", yml: "yaml", yaml: "yaml",
  css: "css", scss: "scss", less: "less", html: "html", htm: "html", xml: "xml", svg: "xml",
  py: "python", rs: "rust", go: "go", java: "java", kt: "kotlin", cs: "csharp",
  c: "c", h: "c", cpp: "cpp", hpp: "cpp", cc: "cpp", sh: "shell", bash: "shell",
  ps1: "powershell", sql: "sql", rb: "ruby", php: "php", swift: "swift",
  toml: "ini", ini: "ini", dockerfile: "dockerfile", lua: "lua", r: "r", dart: "dart",
};

export function languageOf(path: string) {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (name === "dockerfile") return "dockerfile";
  return LANGUAGES[name.slice(name.lastIndexOf(".") + 1)] ?? "plaintext";
}
