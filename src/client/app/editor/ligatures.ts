/**
 * Keeps ligatures intact while typing. Chromium reshapes only the edited
 * part of a line, but a ligature depends on its neighbours: typing `<->` or
 * `###` in JetBrains Mono left blanks where its spacer glyphs stood
 * (GENBEYA-27), and other fonts kept the characters unjoined. Every edit
 * flips the content between two font settings that render the same (kerning
 * is on by default), which makes Chromium shape the visible lines afresh.
 */
import { StateField, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

const flipped = StateField.define<boolean>({
  create: () => false,
  update: (value, transaction) => (transaction.docChanged ? !value : value),
});

export const reshapeLigatures: Extension = [
  flipped,
  EditorView.contentAttributes.from(flipped, (value) => ({ class: value ? "cm-reshaped" : "" })),
  EditorView.theme({
    ".cm-content": { fontFeatureSettings: "normal" },
    ".cm-content.cm-reshaped": { fontFeatureSettings: '"kern" 1' },
  }),
];
