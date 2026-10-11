import { CompletionContext, type Completion } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { blockSource } from "./block-completion";

function complete(doc: string) {
  const pos = doc.indexOf("|");
  const view = new EditorView({ state: EditorState.create({ doc: doc.replace("|", ""), selection: { anchor: pos } }) });
  const result = blockSource(new CompletionContext(view.state, pos, false));
  const apply = (label: string) => {
    const option = result!.options.find((candidate) => candidate.label === label)! as Completion & {
      apply: (view: EditorView, completion: Completion, from: number, to: number) => void;
    };
    option.apply(view, option, result!.from, pos);
    return view.state.sliceDoc();
  };
  return { result, apply, view };
}

describe("block completion", () => {
  it("offers blocks after / at the start of a line", () => {
    const { result } = complete("Intro\n/ma|");
    expect(result?.from).toBe("Intro\n/".length);
    expect(result?.options.map((option) => option.label)).toContain("Math");
    expect(complete("  /|").result).not.toBeNull();
  });

  it("stays out of text, paths and // dates", () => {
    expect(complete("See /ma|").result).toBeNull();
    expect(complete("src/app|").result).toBeNull();
    expect(complete("//|").result).toBeNull();
    expect(complete("/math x|").result).toBeNull();
  });

  it("replaces the command with the block", () => {
    expect(complete("/ma|").apply("Math")).toBe("$$\nx^2\n$$");
    expect(complete("/|").apply("Foldable callout")).toBe("> [!TIP]- Title\n> ");
    expect(complete("  /de|").apply("Collapsible section")).toBe("  <details>\n  <summary>Summary</summary>\n  \n  \n  \n  </details>");
  });
});
