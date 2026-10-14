import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { reshapeLigatures } from "./ligatures";

describe("reshapeLigatures", () => {
  it("flips the content's font settings on every edit, and only then", () => {
    const view = new EditorView({ state: EditorState.create({ doc: "<-", extensions: reshapeLigatures }), parent: document.body });
    onTestFinished(() => view.destroy());
    const reshaped = () => view.contentDOM.classList.contains("cm-reshaped");

    expect(reshaped()).toBe(false);
    view.dispatch({ changes: { from: 2, insert: ">" } });
    expect(reshaped()).toBe(true);
    view.dispatch({ selection: { anchor: 0 } });
    expect(reshaped()).toBe(true);
    view.dispatch({ changes: { from: 3, insert: " " } });
    expect(reshaped()).toBe(false);
  });
});
