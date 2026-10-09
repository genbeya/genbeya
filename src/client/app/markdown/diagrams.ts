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

@Injectable({ providedIn: "root" })
export class Diagrams {
  private readonly rockuml = inject(RockumlRenderer);
  private readonly theme = inject(Theme);
  private mermaid: Promise<Mermaid> | null = null;
  private counter = 0;

  async draw(language: "mermaid" | "plantuml", source: string): Promise<DrawnDiagram> {
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
    return { svg, isError: false };
  }
}
