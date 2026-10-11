import katex from "katex";
import { styledText } from "./math-alphabets";
import { MATHML, mathElement } from "./mathml";

const typeset = (source: string, display = false) =>
  mathElement(
    katex.renderToString(source, { output: "mathml", trust: false, strict: "ignore", maxSize: 20, displayMode: display }),
    document,
  )!;

const names = (element: Element) => [element, ...element.querySelectorAll("*")].map((node) => node.localName);

describe("MathML from KaTeX", () => {
  it("rebuilds the formula as MathML elements, with the source as annotation", () => {
    const math = typeset("\\frac{a}{b} + \\sqrt{x}", true);
    expect(math.namespaceURI).toBe(MATHML);
    expect(math.getAttribute("display")).toBe("block");
    expect(names(math)).toEqual(expect.arrayContaining(["math", "semantics", "mfrac", "msqrt", "mi", "mo", "annotation"]));
    expect(math.querySelector("annotation")?.getAttribute("encoding")).toBe("application/x-tex");
    expect(math.querySelector("annotation")?.textContent).toBe("\\frac{a}{b} + \\sqrt{x}");
    expect([...math.querySelectorAll("*")].every((element) => element.namespaceURI === MATHML)).toBe(true);
  });

  it("writes styled letters as Unicode characters, which MathML Core needs", () => {
    const math = typeset("\\mathbb{R} \\mathbf{x} \\mathcal{L} \\boldsymbol{\\alpha} \\mathrm{d}x");
    expect(math.querySelector("mrow")?.textContent).toBe("ℝ𝐱ℒ𝜶dx");
    expect(math.querySelector("[mathvariant='double-struck']")).toBeNull();
    // `normal` is MathML Core: an upright single letter.
    expect(math.querySelector("mi[mathvariant='normal']")?.textContent).toBe("d");
  });

  it("keeps colours, and turns black into the text colour for the dark theme", () => {
    const math = typeset("\\textcolor{red}{x} \\rule{1em}{1em}");
    expect(math.querySelector("[mathcolor]")?.getAttribute("mathcolor")).toBe("red");
    expect(math.querySelector("[mathbackground]")?.getAttribute("mathbackground")).toBe("currentcolor");
  });

  it.each([
    "\\href{javascript:alert(1)}{x}",
    "\\url{javascript:alert(1)}",
    "\\htmlClass{evil}{x}",
    "\\htmlStyle{position:fixed}{x}",
    "\\htmlData{x=1}{x}",
    "\\includegraphics{https://example.com/x.png}",
  ])("shows untrusted %s as text, without links, classes or styles", (source) => {
    const math = typeset(source);
    for (const element of [math, ...math.querySelectorAll("*")])
      expect(element.getAttributeNames().filter((name) => /href|src|class|style|^data-|^on/.test(name))).toEqual([]);
  });

  it("caps sizes", () => {
    const math = typeset("\\rule{100000em}{100000em}");
    expect(math.querySelector("mspace")?.getAttribute("width")).toBe("20em");
  });

  it("drops anything that is not allowlisted MathML", () => {
    const math = mathElement(
      '<math><mi onclick="alert(1)" style="position:fixed" href="javascript:x" mathcolor="url(x)" width="1em">x</mi>' +
        '<mtext><img src=x onerror=alert(1)><b>bold</b></mtext><script>alert(1)</script><maction actiontype="toggle"><mi>y</mi></maction>' +
        '<annotation-xml encoding="text/html"><a href="x">z</a></annotation-xml><annotation encoding="text/html">w</annotation></math>',
      document,
    )!;
    expect(math.outerHTML).toBe('<math><mi width="1em">x</mi><mtext></mtext><annotation>w</annotation></math>');
  });

  it("returns null without a formula", () => {
    expect(mathElement("<span>x</span>", document)).toBeNull();
  });
});

describe("mathematical alphabets", () => {
  it.each([
    ["bold", "Ab1", "𝐀𝐛𝟏"],
    ["italic", "h", "ℎ"],
    ["script", "BEe", "ℬℰℯ"],
    ["fraktur", "gZ", "𝔤ℨ"],
    ["double-struck", "NZ2", "ℕℤ𝟚"],
    ["monospace", "x", "𝚡"],
    ["bold", "Σω", "𝚺𝛚"],
    ["bold", "+", "+"],
  ])("writes %s %s as %s", (variant, text, styled) => {
    expect(styledText(text, variant)).toBe(styled);
  });

  it("has no alphabet for normal or unknown variants", () => {
    expect(styledText("x", "normal")).toBeNull();
    expect(styledText("x", "initial")).toBeNull();
  });
});
