/**
 * Typesets LaTeX with KaTeX, loaded on first use, as MathML: the browser
 * lays it out with the bundled STIX Two Math font, without KaTeX's styles,
 * fonts and inline style attributes. The markup goes through the MathML
 * allowlist (mathml.ts), never into innerHTML.
 */
import { Injectable } from "@angular/core";
import type katex from "katex";
import type { KatexOptions } from "katex";
import { mathElement } from "./mathml";

type Katex = typeof katex;

export type Typeset = { readonly math: Element } | { readonly error: string };

const OPTIONS: KatexOptions = {
  output: "mathml",
  throwOnError: true,
  // No \href, \url, \includegraphics or \html… commands: they show as red text.
  trust: false,
  strict: "warn",
  // Caps \rule, \kern and friends (in em) and macro expansion.
  maxSize: 20,
  maxExpand: 500,
};
/** Longer formulas are refused rather than typeset. */
const MAX_LENGTH = 10_000;
/** Typeset formulas kept, so re-rendering a page (typing in the preview) is instant. */
const CACHED = 256;

@Injectable({ providedIn: "root" })
export class Typesetter {
  private katex: Promise<Katex> | null = null;
  private readonly typeset = new Map<string, Typeset>();

  /** A fresh copy each time, ready to insert. */
  async render(source: string, display: boolean): Promise<Typeset> {
    const key = `${display ? "D" : "I"}:${source}`;
    let result = this.typeset.get(key);
    if (result) this.typeset.delete(key);
    else result = this.compile(await (this.katex ??= import("katex").then((module) => module.default)), source, display);
    this.typeset.set(key, result);
    if (this.typeset.size > CACHED) this.typeset.delete(this.typeset.keys().next().value!);
    return "math" in result ? { math: result.math.cloneNode(true) as Element } : result;
  }

  private compile(katex: Katex, source: string, display: boolean): Typeset {
    if (source.length > MAX_LENGTH) return { error: `Formulas can be at most ${MAX_LENGTH} characters long.` };
    try {
      const math = mathElement(katex.renderToString(source, { ...OPTIONS, displayMode: display }), document);
      return math ? { math } : { error: "KaTeX returned no formula." };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }
}
