/**
 * VS Code's editing keys and mouse gestures: several cursors, line
 * commands, folding, find and replace, go to line and word wrap.
 * docs/Guide/Keyboard-shortcuts.md lists them.
 */
import { closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, historyKeymap, indentWithTab, redo, selectLine } from "@codemirror/commands";
import { foldKeymap } from "@codemirror/language";
import { gotoLine, SearchCursor, selectNextOccurrence, selectSelectionMatches } from "@codemirror/search";
import { Compartment, EditorSelection, EditorState, type Extension, type StateCommand } from "@codemirror/state";
import { type Command, crosshairCursor, EditorView, type KeyBinding, keymap, rectangularSelection } from "@codemirror/view";
import { findKeymap } from "./find-widget";

/** Alt+click adds a cursor; Shift+Alt+drag or dragging with the middle button selects a rectangle. */
export const multipleCursors: Extension = [
  EditorState.allowMultipleSelections.of(true),
  EditorView.clickAddsSelectionRange.of((event) => event.altKey),
  rectangularSelection({ eventFilter: (event) => (event.button === 0 && event.altKey && event.shiftKey) || event.button === 1 }),
  crosshairCursor({ key: "Alt" }),
];

/**
 * Selects every occurrence of the selection, or of the word at the cursor
 * (whole words only then, as Ctrl+D picks them).
 */
export const selectAllOccurrences: StateCommand = ({ state, dispatch }) => {
  const { main } = state.selection;
  if (!main.empty) return selectSelectionMatches({ state, dispatch });
  const word = state.wordAt(main.head);
  if (!word) return false;
  const ranges = [];
  let mainIndex = 0;
  for (const cursor = new SearchCursor(state.doc, state.sliceDoc(word.from, word.to)); !cursor.next().done;) {
    const { from, to } = cursor.value;
    const around = state.wordAt(from);
    if (around?.from !== from || around.to !== to) continue;
    if (from === word.from) mainIndex = ranges.length;
    ranges.push(EditorSelection.range(from, to));
  }
  dispatch(state.update({ selection: EditorSelection.create(ranges, mainIndex), userEvent: "select.search.matches" }));
  return true;
};

const wrapping = new Compartment();

/** Soft wrapping of long lines, which Alt+Z switches. */
export const wordWrap = (on: boolean): Extension => wrapping.of(on ? EditorView.lineWrapping : []);

export const toggleWordWrap: Command = (view) => {
  const current = wrapping.get(view.state);
  if (current === undefined) return false;
  view.dispatch({ effects: wrapping.reconfigure(current === EditorView.lineWrapping ? [] : EditorView.lineWrapping) });
  return true;
};

/** Alt+Z by key position: on macOS Option+Z types "Ω", which a key name would not match. */
const wordWrapKey = EditorView.domEventHandlers({
  keydown: (event, view) =>
    event.code === "KeyZ" && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && toggleWordWrap(view),
});

/**
 * On Windows AltGr reports Ctrl+Alt, so typing "[" or "\" on a Swiss or
 * German keyboard would otherwise fold everything or reindent. Keys typed
 * with AltGr run no command and type their character.
 */
let typedWithAltGraph = false;
const altGraphObserver = EditorView.domEventObservers({
  keydown: (event) => {
    typedWithAltGraph = event.key.length === 1 && event.ctrlKey && event.altKey && event.getModifierState("AltGraph");
  },
});
const unlessAltGraph =
  (command: Command): Command =>
  (view) =>
    !typedWithAltGraph && command(view);
const guarded = ({ run, shift, ...binding }: KeyBinding): KeyBinding => ({
  ...binding,
  ...(run ? { run: unlessAltGraph(run) } : {}),
  ...(shift ? { shift: unlessAltGraph(shift) } : {}),
});

const bindings: readonly KeyBinding[] = [
  ...closeBracketsKeymap,
  ...findKeymap,
  { key: "Mod-d", run: selectNextOccurrence, preventDefault: true },
  { key: "Mod-Shift-l", run: selectAllOccurrences, preventDefault: true },
  { key: "Mod-l", run: selectLine, preventDefault: true },
  // Ctrl+G on every platform, as in VS Code; Cmd+G on macOS finds the next match.
  { key: "Ctrl-g", run: gotoLine, preventDefault: true },
  // Besides Ctrl+Y; CodeMirror binds this one only on Linux and macOS.
  { key: "Mod-Shift-z", run: redo, preventDefault: true },
  ...defaultKeymap,
  ...historyKeymap,
  ...foldKeymap,
  indentWithTab,
];

export const editingKeymap: Extension = [altGraphObserver, wordWrapKey, keymap.of(bindings.map(guarded))];
