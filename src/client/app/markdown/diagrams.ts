/**
 * Draws diagram code blocks as SVG: PlantUML with rockuml's WebAssembly
 * engine, Mermaid with Mermaid (loaded on first use). Results are shown
 * as images, so markup inside a diagram can never run.
 */
import { Injectable, inject } from "@angular/core";
import { RockumlRenderer } from "@rockuml/angular";
import type mermaid from "mermaid";
import { Theme } from "../core/theme";

export interface DrawnDiagram {
  readonly svg: string;
  /** The image shows the diagram's errors instead of the diagram. */
  readonly isError: boolean;
}

type Mermaid = typeof mermaid;

/** Drawn diagrams kept, so re-rendering a page (typing in the preview) does not draw them again. */
const CACHED_DIAGRAMS = 64;

@Injectable({ providedIn: "root" })
export class Diagrams {
  private readonly rockuml = inject(RockumlRenderer);
  private readonly theme = inject(Theme);
  private mermaid: Promise<Mermaid> | null = null;
  private counter = 0;
  private readonly drawn = new Map<string, Promise<DrawnDiagram>>();

  draw(language: "mermaid" | "plantuml", source: string): Promise<DrawnDiagram> {
    // Mermaid draws with the theme's colours; PlantUML does not depend on it.
    const key = `${language === "mermaid" ? this.theme.resolved() : ""}:${language}:${source}`;
    let diagram = this.drawn.get(key);
    if (diagram) {
      // Most recently used last, so the oldest goes first.
      this.drawn.delete(key);
    } else {
      diagram = this.render(language, source);
      diagram.catch(() => this.drawn.delete(key));
    }
    this.drawn.set(key, diagram);
    if (this.drawn.size > CACHED_DIAGRAMS) this.drawn.delete(this.drawn.keys().next().value!);
    return diagram;
  }

  private async render(language: "mermaid" | "plantuml", source: string): Promise<DrawnDiagram> {
    if (language === "plantuml") {
      // A bare diagram body is a convenience; rockuml needs the start and end markers.
      const text = /^\s*@start/m.test(source) ? source : `@startuml\n${source}\n@enduml`;
      const { data, isError } = await this.rockuml.render(text);
      return { svg: data, isError };
    }
    const mermaid = await (this.mermaid ??= import("mermaid").then((module) => module.default));
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: this.theme.resolved() === "light" ? "neutral" : "dark",
      fontFamily: "Inter Variable, Segoe UI, sans-serif",
      // Labels as SVG text, so the diagram works as an image.
      flowchart: { htmlLabels: false },
    });
    const { svg } = await mermaid.render(`gd-mermaid-${++this.counter}`, source);
    // As an image, width="100%" would stretch the diagram; keep its natural width instead.
    const width = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) /.exec(svg)?.[1];
    return { svg: width ? svg.replace('width="100%"', `width="${width}"`) : svg, isError: false };
  }
}
