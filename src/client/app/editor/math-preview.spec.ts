import { EditorState, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { mathAt, mathPreview } from "./math-preview";

/** The formula at `|` in `doc`. */
function at(doc: string) {
  const pos = doc.indexOf("|");
  const range = mathAt(Text.of(doc.replace("|", "").split("\n")), pos);
  return range && { source: range.source, display: range.display };
}

describe("formula under the cursor", () => {
  it("finds $…$ and $$…$$ on the line", () => {
    expect(at("Euler $e^{i|\\pi}$ here")).toEqual({ source: "e^{i\\pi}", display: false });
    expect(at("|$x$")).toEqual({ source: "x", display: false });
    expect(at("$$a + |b$$")).toEqual({ source: "a + b", display: true });
    expect(at("Euler $e$ |here")).toBeNull();
  });

  it("leaves prices alone", () => {
    expect(at("It costs $5 and |$10.")).toBeNull();
    expect(at("$ x |$")).toBeNull();
  });

  it("finds $$ blocks and ```math fences around the cursor", () => {
    expect(at("Intro\n\n$$\n\\int_0^1 |f\n$$\n\nOutro")).toEqual({ source: "\\int_0^1 f", display: true });
    expect(at("$$\na\n$|$")).toEqual({ source: "a", display: true });
    expect(at("```math\nx |= 1\n```")).toEqual({ source: "x = 1", display: true });
    expect(at("$$ a\nb| $$")).toEqual({ source: "a\nb", display: true });
  });

  it("knows where blocks end", () => {
    expect(at("$$\na\n$$\n\nAfter |$5")).toBeNull();
    expect(at("$$\na\n$$\n\n$$\nb|\n$$")).toEqual({ source: "b", display: true });
  });

  it("ignores dollars in code", () => {
    expect(at("```sh\necho $HOME$|x\n```")).toBeNull();
    expect(at("```\n$$\n```\n\n$x|$")).toEqual({ source: "x", display: false });
  });
});

describe("math preview", () => {
  it("shows the typeset formula while the cursor is in it", async () => {
    const math = document.createElementNS("http://www.w3.org/1998/Math/MathML", "math");
    const typeset = vi.fn().mockResolvedValue({ math });
    const view = new EditorView({
      state: EditorState.create({ doc: "See $x^2$ here", selection: { anchor: 6 }, extensions: mathPreview(typeset) }),
      parent: document.body,
    });
    await vi.waitFor(() => expect(view.dom.querySelector(".cm-math-preview math")).toBe(math));
    expect(typeset).toHaveBeenCalledWith("x^2", false);
    view.dispatch({ selection: { anchor: 13 } });
    expect(view.dom.querySelector(".cm-math-preview")).toBeNull();
    view.destroy();
  });

  it("shows KaTeX's errors", async () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "$\\frac{$",
        selection: { anchor: 2 },
        extensions: mathPreview(async () => ({ error: "Parse error" })),
      }),
      parent: document.body,
    });
    await vi.waitFor(() => expect(view.dom.querySelector(".cm-math-preview.is-error")?.textContent).toBe("Parse error"));
    view.destroy();
  });
});
