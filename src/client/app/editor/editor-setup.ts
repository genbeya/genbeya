/**
 * The look and behaviour every CodeMirror instance shares. Colours come
 * from the design tokens, so editors follow the theme without reconfiguring.
 */
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  HighlightStyle,
  indentOnInput,
  LanguageDescription,
  syntaxHighlighting,
  type LanguageSupport,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import type { Extension } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";

export const editorTheme = EditorView.theme({
  "&": { height: "100%", color: "var(--text)", backgroundColor: "transparent", fontSize: "13px" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "21px", padding: "14px 0" },
  ".cm-content": { caretColor: "var(--accent)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  "&.cm-focused": { outline: "none" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "var(--accent-soft) !important" },
  ".cm-activeLine": { backgroundColor: "var(--bg-hover)" },
  ".cm-gutters": { backgroundColor: "transparent", color: "var(--text-3)", border: "none", paddingLeft: "6px" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text-2)" },
  ".cm-foldPlaceholder": { backgroundColor: "var(--bg-active)", border: "none", color: "var(--text-2)" },
  ".cm-searchMatch": { backgroundColor: "var(--yellow-soft)", outline: "1px solid var(--yellow)" },
  ".cm-selectionMatch": { backgroundColor: "var(--bg-active)" },
  ".cm-matchingBracket": { backgroundColor: "var(--bg-active)", outline: "1px solid var(--line-strong)" },
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
  ".cm-collapsedLines": {
    background: "var(--bg-hover) !important",
    color: "var(--text-3)",
    fontFamily: "var(--font-ui)",
    fontSize: "12px",
    padding: "4px 12px",
  },
});

/** Syntax colours, matching the Markdown code highlighting. */
const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.operatorKeyword, tags.modifier, tags.controlKeyword], color: "var(--purple)" },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "var(--green)" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "var(--orange)" },
  { tag: [tags.comment, tags.meta], color: "var(--text-3)", fontStyle: "italic" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "var(--blue)" },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "var(--yellow)" },
  { tag: [tags.tagName, tags.heading], color: "var(--accent-text)", fontWeight: "600" },
  { tag: [tags.attributeName, tags.propertyName], color: "var(--text-2)" },
  { tag: tags.link, color: "var(--accent-text)", textDecoration: "underline" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.invalid, color: "var(--red)" },
]);

/** Editing behaviour; line numbers and folding are optional for prose. */
export function editingSetup(numbered: boolean): Extension[] {
  return [
    ...(numbered ? [lineNumbers(), highlightActiveLineGutter(), foldGutter()] : []),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    rectangularSelection(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    syntaxHighlighting(highlight),
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
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
