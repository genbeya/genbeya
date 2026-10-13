import { previewKind, previewMarkdown } from "./preview-kinds";

describe("previewKind", () => {
  it("knows Markdown, diagram sources and SVG", () => {
    expect(previewKind("docs/Home.md")).toBe("markdown");
    expect(previewKind("README.MARKDOWN")).toBe("markdown");
    expect(previewKind("flows/login.mmd")).toBe("mermaid");
    expect(previewKind("model.puml")).toBe("plantuml");
    expect(previewKind("model.plantuml")).toBe("plantuml");
    expect(previewKind("logo.svg")).toBe("svg");
  });

  it("has no preview for other files", () => {
    expect(previewKind("src/main.ts")).toBeNull();
    expect(previewKind("notes.txt")).toBeNull();
    expect(previewKind("md")).toBeNull();
  });
});

describe("previewMarkdown", () => {
  it("passes Markdown through", () => {
    expect(previewMarkdown("markdown", "# Title\n")).toBe("# Title\n");
  });

  it("wraps diagram sources in a diagram block", () => {
    expect(previewMarkdown("mermaid", "graph TD\n  A --> B")).toBe("```mermaid\ngraph TD\n  A --> B\n```\n");
    expect(previewMarkdown("plantuml", "@startuml\nA -> B\n@enduml")).toBe("```plantuml\n@startuml\nA -> B\n@enduml\n```\n");
  });

  it("uses a longer fence than any backticks in the source", () => {
    expect(previewMarkdown("plantuml", "note: ```x```")).toBe("````plantuml\nnote: ```x```\n````\n");
  });
});
