/**
 * Folding: chevrons in the gutter that show while the pointer is over it
 * (a folded block keeps its chevron), and a "⋯" pill for the hidden lines.
 * Code folds by syntax, Markdown by heading.
 */
import { codeFolding, foldGutter } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { iconElement } from "../ui/icon";

function marker(open: boolean): HTMLElement {
  const element = document.createElement("span");
  element.className = open ? "cm-foldMarker" : "cm-foldMarker is-folded";
  element.append(iconElement(open ? "chevron-down" : "chevron-right", 14));
  return element;
}

const theme = EditorView.theme({
  ".cm-foldGutter .cm-gutterElement": { display: "grid", placeItems: "center", padding: "0 2px" },
  ".cm-foldMarker": { display: "grid", color: "var(--text-3)", cursor: "pointer", opacity: "0", transition: "opacity 120ms" },
  ".cm-gutters:hover .cm-foldMarker, .cm-foldMarker.is-folded": { opacity: "1" },
  ".cm-foldMarker:hover": { color: "var(--text)" },
  ".cm-foldPlaceholder": {
    margin: "0 3px",
    padding: "0 5px",
    border: "none",
    borderRadius: "var(--radius-s)",
    backgroundColor: "var(--accent-soft)",
    color: "var(--accent-text)",
    fontFamily: "var(--font-ui)",
    cursor: "pointer",
  },
  ".cm-foldPlaceholder:hover": { backgroundColor: "color-mix(in srgb, var(--accent) 28%, transparent)" },
});

export function folding(): Extension {
  return [codeFolding({ placeholderText: "⋯" }), foldGutter({ markerDOM: marker }), theme];
}
