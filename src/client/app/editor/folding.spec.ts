import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, foldAll, foldedRanges, unfoldAll } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editingSetup, languageFor } from "./editor-setup";

function editor(doc: string, numbered: boolean, language: Extension) {
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [...editingSetup(numbered), language] }),
    parent: document.body,
  });
  onTestFinished(() => view.destroy());
  ensureSyntaxTree(view.state, view.state.doc.length);
  return view;
}

const folded = (view: EditorView) => {
  const ranges: string[] = [];
  foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => void ranges.push(view.state.sliceDoc(from, to)));
  return ranges;
};

describe("folding", () => {
  it("folds Markdown by heading, also in prose editors without line numbers", () => {
    const view = editor("# Title\n\nIntro\n\n## Part\n\nText\n", false, markdown());
    expect(view.dom.querySelector(".cm-foldGutter")).not.toBeNull();
    foldAll(view);
    expect(folded(view)).toEqual(["\n\nIntro\n\n## Part\n\nText"]);
    unfoldAll(view);
    expect(folded(view)).toEqual([]);
  });

  it("folds code by syntax and shows a placeholder", async () => {
    const view = editor("function f() {\n  return 1;\n}\n", true, (await languageFor("a.ts"))!);
    ensureSyntaxTree(view.state, view.state.doc.length);
    foldAll(view);
    expect(folded(view)).toEqual(["\n  return 1;\n"]);
    expect(view.dom.querySelector(".cm-foldPlaceholder")?.textContent).toBe("⋯");
    expect(view.dom.querySelector(".cm-foldMarker.is-folded")).not.toBeNull();
  });
});
