import { CompletionContext, type Completion } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { referenceSource, type ReferenceCandidate } from "./reference-completion";

const candidates: ReferenceCandidate[] = [
  { target: "GENBEYA-12", label: "GENBEYA-12 Virtualize lists", detail: "In progress", kind: "task" },
  { target: "Home", label: "Home", kind: "page" },
  { target: "src/app.ts", label: "src/app.ts", kind: "file" },
];

function complete(doc: string) {
  const view = new EditorView({ state: EditorState.create({ doc, selection: { anchor: doc.indexOf("|") } }) });
  view.dispatch({ changes: { from: doc.indexOf("|"), to: doc.indexOf("|") + 1 } });
  const result = referenceSource(() => candidates)(new CompletionContext(view.state, view.state.selection.main.head, false));
  const apply = (label: string) => {
    const option = result!.options.find((candidate) => candidate.label === label)! as Completion & {
      apply: (view: EditorView, completion: Completion, from: number, to: number) => void;
    };
    option.apply(view, option, result!.from, view.state.selection.main.head);
    return view.state.sliceDoc();
  };
  return { result, apply, view };
}

describe("reference completion", () => {
  it("offers tasks, pages and files after an open [[", () => {
    const { result } = complete("See [[Vir|");
    expect(result?.from).toBe(6);
    expect(result?.options.map((option) => option.label)).toEqual(["GENBEYA-12 Virtualize lists", "Home", "src/app.ts"]);
    expect(complete("See [Vir|").result).toBeNull();
    expect(complete("[[Done]] and |").result).toBeNull();
  });

  it("inserts the target and closes the brackets once", () => {
    expect(complete("See [[Vir|").apply("GENBEYA-12 Virtualize lists")).toBe("See [[GENBEYA-12]]");
    const closed = complete("See [[|]]");
    expect(closed.apply("src/app.ts")).toBe("See [[src/app.ts]]");
    expect(closed.view.state.selection.main.head).toBe("See [[src/app.ts]]".length);
  });
});
