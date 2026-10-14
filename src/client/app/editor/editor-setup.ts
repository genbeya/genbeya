/**
 * The look and behaviour every CodeMirror instance shares. Colours come
 * from the design tokens, so editors follow the theme without reconfiguring.
 */
import { closeBrackets } from "@codemirror/autocomplete";
import { history } from "@codemirror/commands";
import { indentOnInput, LanguageDescription, syntaxHighlighting, type LanguageSupport } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightSelectionMatches } from "@codemirror/search";
import type { Extension } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  lineNumbers,
} from "@codemirror/view";
import { brackets } from "./brackets";
import { editingKeymap, multipleCursors } from "./editor-keymap";
import { findWidget } from "./find-widget";
import { folding } from "./folding";
import { highlight } from "./syntax";

export const editorTheme = EditorView.theme({
  "&": { height: "100%", color: "var(--text)", backgroundColor: "transparent", fontSize: "13px" },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    fontVariantLigatures: "var(--mono-ligatures, normal)",
    lineHeight: "21px",
    padding: "14px 0",
  },
  ".cm-content": { caretColor: "var(--accent)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  "&.cm-focused": { outline: "none" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "var(--accent-soft) !important" },
  ".cm-activeLine": { backgroundColor: "var(--bg-hover)" },
  // Opaque, so text scrolled sideways passes under the line numbers.
  ".cm-gutters": { backgroundColor: "var(--bg-panel)", color: "var(--text-3)", border: "none", paddingLeft: "6px" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text-2)" },
  ".cm-searchMatch": { backgroundColor: "var(--yellow-soft)", outline: "1px solid var(--yellow)" },
  ".cm-selectionMatch": { backgroundColor: "var(--bg-active)" },
  ".cm-panels": { backgroundColor: "var(--bg-raised)", color: "var(--text)", borderColor: "var(--line)" },
  ".cm-panel input, .cm-panel button": { font: "inherit", color: "inherit" },
  ".cm-tooltip": { backgroundColor: "var(--bg-overlay)", border: "none", boxShadow: "var(--shadow-pop)", borderRadius: "var(--radius)" },
  // Diffs: the old side (and unified deletions) red, the new side green.
  "&.cm-merge-a .cm-changedLine, .cm-deletedChunk": { backgroundColor: "var(--red-soft) !important" },
  "&.cm-merge-b .cm-changedLine, .cm-insertedLine": { backgroundColor: "var(--green-soft) !important" },
  "&.cm-merge-a .cm-changedText, .cm-deletedChunk .cm-deletedText": {
    background: "color-mix(in srgb, var(--red) 30%, transparent) !important",
  },
  "&.cm-merge-b .cm-changedText, .cm-insertedLine .cm-changedText": {
    background: "color-mix(in srgb, var(--green) 30%, transparent) !important",
  },
  "&.cm-merge-a .cm-changedLineGutter": { background: "var(--red) !important" },
  "&.cm-merge-b .cm-changedLineGutter": { background: "var(--green) !important" },
  // The actions above each changed chunk of a diff whose lines can be staged.
  ".cm-hunkBar": {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "3px 8px",
    overflow: "hidden",
    borderTop: "1px solid var(--line)",
    background: "var(--bg-panel)",
    color: "var(--text-3)",
    fontFamily: "var(--font-ui)",
    fontSize: "12px",
    lineHeight: "20px",
  },
  // The label gives way first where the bar is narrow, as beside the original.
  ".cm-hunkLabel": { flex: "1 1 0", minWidth: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  ".cm-hunkButton": {
    flex: "none",
    padding: "0 8px",
    whiteSpace: "nowrap",
    border: "1px solid var(--line)",
    borderRadius: "var(--radius-s)",
    background: "var(--bg-raised)",
    color: "var(--text-2)",
    font: "inherit",
    cursor: "pointer",
  },
  ".cm-hunkButton:hover": { background: "var(--bg-hover)", color: "var(--text)" },
  ".cm-hunkButton.is-danger:hover": { color: "var(--red)" },
  ".cm-hunkButton:focus-visible": { outline: "1px solid var(--accent)" },
  ".cm-collapsedLines": {
    background: "var(--bg-hover) !important",
    color: "var(--text-3)",
    fontFamily: "var(--font-ui)",
    fontSize: "12px",
    padding: "4px 12px",
  },
});

/** Editing as in VS Code (see editor-keymap.ts); line numbers are optional for prose. */
export function editingSetup(numbered: boolean): Extension[] {
  return [
    ...(numbered ? [lineNumbers(), highlightActiveLineGutter()] : []),
    folding(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    multipleCursors,
    indentOnInput(),
    brackets(),
    closeBrackets(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    findWidget(),
    syntaxHighlighting(highlight),
    editingKeymap,
    editorTheme,
  ];
}

/** Read-only display (diffs). */
export function viewingSetup(): Extension[] {
  return [
    lineNumbers(),
    highlightSpecialChars(),
    drawSelection(),
    syntaxHighlighting(highlight),
    EditorView.editable.of(false),
    editorTheme,
  ];
}

/** The language of a file, loaded on demand; null for plain text. */
export async function languageFor(path: string): Promise<LanguageSupport | null> {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const description = LanguageDescription.matchFilename(languages, name);
  return description ? description.load() : null;
}

export const isProse = (path: string): boolean => /\.(md|markdown|txt)$/i.test(path);
