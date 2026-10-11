import { TestBed } from "@angular/core/testing";
import { MATHML } from "./mathml";
import { Typesetter } from "./typesetter";

describe("Typesetter", () => {
  const typesetter = () => TestBed.inject(Typesetter);

  it("typesets LaTeX as MathML, inline or as a block", async () => {
    const inline = await typesetter().render("x^2", false);
    const block = await typesetter().render("x^2", true);
    if (!("math" in inline) || !("math" in block)) throw new Error("Not typeset");
    expect(inline.math.namespaceURI).toBe(MATHML);
    expect(inline.math.querySelector("msup")).not.toBeNull();
    expect(inline.math.hasAttribute("display")).toBe(false);
    expect(block.math.getAttribute("display")).toBe("block");
  });

  it("hands out a fresh copy each time", async () => {
    const first = await typesetter().render("a", false);
    const second = await typesetter().render("a", false);
    expect("math" in first && "math" in second && first.math !== second.math).toBe(true);
  });

  it("reports errors with KaTeX's message", async () => {
    expect(await typesetter().render("\\frac{", false)).toEqual({ error: expect.stringContaining("KaTeX parse error") });
    expect(await typesetter().render("\\undefinedcommand", false)).toEqual({
      error: expect.stringContaining("Undefined control sequence"),
    });
  });

  it("refuses formulas that expand without end, and very long ones", async () => {
    expect(await typesetter().render("\\def\\a{\\a\\a}\\a", false)).toEqual({ error: expect.stringContaining("Too many expansions") });
    expect(await typesetter().render("x".repeat(10_001), false)).toEqual({ error: expect.stringContaining("at most") });
  });
});
