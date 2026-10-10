import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editingSetup, languageFor } from "./editor-setup";

async function editor(doc: string, cursor: number) {
  const language = (await languageFor("a.ts"))!;
  const view = new EditorView({
    state: EditorState.create({ doc, selection: { anchor: cursor }, extensions: [...editingSetup(true), language] }),
    parent: document.body,
  });
  onTestFinished(() => view.destroy());
  ensureSyntaxTree(view.state, doc.length);
  // A transaction lets the plugins see the parsed tree.
  view.dispatch({});
  return view;
}

const texts = (view: EditorView, selector: string) => [...view.dom.querySelectorAll(selector)].map((element) => element.textContent);

describe("brackets", () => {
  it("colours bracket pairs by depth", async () => {
    const view = await editor("f(a[{ b: [1] }]);", 0);
    // Colours repeat after three levels: the innermost [1] is coloured like the outer ( ).
    expect(texts(view, ".cm-bracket-0")).toEqual(["(", "[", "]", ")"]);
    expect(texts(view, ".cm-bracket-1")).toEqual(["[", "]"]);
    expect(texts(view, ".cm-bracket-2")).toEqual(["{", "}"]);
  });

  it("marks the matching bracket, and a bracket without a partner", async () => {
    const view = await editor("f(a);", 1);
    expect(texts(view, ".cm-matchingBracket")).toEqual(["(", ")"]);
    const unmatched = await editor("f(a];", 1);
    expect(texts(unmatched, ".cm-nonmatchingBracket")).toContain("(");
  });
});
