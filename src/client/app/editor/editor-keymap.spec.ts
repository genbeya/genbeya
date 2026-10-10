import { foldedRanges, foldService } from "@codemirror/language";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { wordWrap } from "./editor-keymap";
import { editingSetup } from "./editor-setup";

function editor(doc: string, cursor = 0, ...extensions: Extension[]) {
  const view = new EditorView({
    state: EditorState.create({ doc, selection: { anchor: cursor }, extensions: [...editingSetup(true), ...extensions] }),
    parent: document.body,
  });
  onTestFinished(() => view.destroy());
  return view;
}

function press(view: EditorView, key: string, modifiers: KeyboardEventInit = {}) {
  view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...modifiers }));
}

const selected = (view: EditorView) => view.state.selection.ranges.map((range) => view.state.sliceDoc(range.from, range.to));

describe("editing keys", () => {
  it("adds the next occurrence with Ctrl+D, so typing replaces them all", () => {
    const view = editor("foo bar foo foo", 1);
    for (let i = 0; i < 3; i++) press(view, "d", { ctrlKey: true });
    expect(selected(view)).toEqual(["foo", "foo", "foo"]);
    view.dispatch(view.state.replaceSelection("baz"));
    expect(view.state.sliceDoc()).toBe("baz bar baz baz");
  });

  it("selects every whole-word occurrence of the word at the cursor with Ctrl+Shift+L", () => {
    const view = editor("ab a cab a", 3);
    press(view, "L", { ctrlKey: true, shiftKey: true, keyCode: 76 } as KeyboardEventInit);
    expect(view.state.selection.ranges.map((range) => range.from)).toEqual([3, 9]);
    expect(view.state.selection.main.from).toBe(3);
  });

  it("adds cursors with Alt+click and Ctrl+Alt+Down, and Escape leaves one", () => {
    const view = editor("one\ntwo\nthree");
    const addsRange = view.state.facet(EditorView.clickAddsSelectionRange)[0]!;
    expect(addsRange(new MouseEvent("mousedown", { altKey: true }))).toBe(true);
    expect(addsRange(new MouseEvent("mousedown", { ctrlKey: true }))).toBe(false);
    view.dispatch({ selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(4)]) });
    expect(view.state.selection.ranges).toHaveLength(2);
    press(view, "Escape");
    expect(view.state.selection.ranges).toHaveLength(1);
  });

  it("moves, copies and deletes lines", () => {
    const view = editor("one\ntwo", 0);
    press(view, "ArrowDown", { altKey: true });
    expect(view.state.sliceDoc()).toBe("two\none");
    press(view, "ArrowUp", { altKey: true, shiftKey: true });
    expect(view.state.sliceDoc()).toBe("two\none\none");
    press(view, "K", { ctrlKey: true, shiftKey: true, keyCode: 75 } as KeyboardEventInit);
    expect(view.state.sliceDoc()).toBe("two\none");
  });

  it("redoes with Ctrl+Y and Ctrl+Shift+Z", () => {
    const view = editor("a", 1);
    view.dispatch(view.state.replaceSelection("b"));
    press(view, "z", { ctrlKey: true });
    expect(view.state.sliceDoc()).toBe("a");
    press(view, "Z", { ctrlKey: true, shiftKey: true, keyCode: 90 } as KeyboardEventInit);
    expect(view.state.sliceDoc()).toBe("ab");
    press(view, "z", { ctrlKey: true });
    press(view, "y", { ctrlKey: true });
    expect(view.state.sliceDoc()).toBe("ab");
  });

  it("goes to a line with Ctrl+G", () => {
    const view = editor("one\ntwo\nthree");
    press(view, "g", { ctrlKey: true });
    const dialog = view.dom.querySelector<HTMLFormElement>(".cm-goto-line form")!;
    const field = dialog.querySelector("input")!;
    field.value = "3";
    dialog.dispatchEvent(new Event("submit", { cancelable: true }));
    return vi.waitFor(() => expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(3));
  });

  it("switches word wrap with Alt+Z", () => {
    const view = editor("a long line", 0, wordWrap(false));
    const wraps = () => view.contentDOM.classList.contains("cm-lineWrapping");
    expect(wraps()).toBe(false);
    press(view, "z", { altKey: true, code: "KeyZ" });
    expect(wraps()).toBe(true);
    press(view, "Ω", { altKey: true, code: "KeyZ" });
    expect(wraps()).toBe(false);
  });

  it("folds everything with Ctrl+Alt+[, but types the bracket when AltGr makes it", () => {
    const foldAfterFirstLine = foldService.of((state, from) => (from === 0 ? { from: state.doc.line(1).to, to: state.doc.length } : null));
    const view = editor("{\n  a\n}", 0, foldAfterFirstLine);
    const folds = () => foldedRanges(view.state).size;
    press(view, "[", { ctrlKey: true, altKey: true, modifierAltGraph: true } as KeyboardEventInit);
    expect(folds()).toBe(0);
    press(view, "[", { ctrlKey: true, altKey: true });
    expect(folds()).toBe(1);
  });
});
