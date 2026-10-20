import { comparisonOf, filePreview, previewMarkdown } from "./file-previews";
import { dataUrlBytes, formatBytes, imageFacts } from "./file-size";

describe("filePreview", () => {
  it("knows Markdown, diagram sources and SVG, edited as text and compared line by line", () => {
    expect(filePreview("docs/Home.md")).toMatchObject({ kind: "markdown", text: true, comparison: "text" });
    expect(filePreview("README.MARKDOWN")?.kind).toBe("markdown");
    expect(filePreview("flows/login.mmd")?.kind).toBe("mermaid");
    expect(filePreview("model.puml")?.kind).toBe("plantuml");
    expect(filePreview("model.plantuml")?.kind).toBe("plantuml");
    expect(filePreview("logo.svg")).toMatchObject({ kind: "svg", text: true, comparison: "text" });
  });

  it("shows the raster images pages show, without their text, and compares them as images", () => {
    for (const path of ["a.png", "b.JPG", "c.jpeg", "d.gif", "e.webp", "f.avif"])
      expect(filePreview(`assets/${path}`)).toMatchObject({ kind: "image", text: false, comparison: "image" });
  });

  it("has no preview for other files", () => {
    expect(filePreview("src/main.ts")).toBeNull();
    expect(filePreview("notes.txt")).toBeNull();
    expect(filePreview("md")).toBeNull();
    expect(filePreview("assets/.png")).toBeNull();
    expect(filePreview("png")).toBeNull();
  });
});

describe("comparisonOf", () => {
  it("compares images as images, other binary files not at all, and text line by line", () => {
    expect(comparisonOf("assets/icon.png", true)).toBe("image");
    expect(comparisonOf("assets/icon.png", false)).toBe("image");
    expect(comparisonOf("archive.zip", true)).toBe("binary");
    expect(comparisonOf("logo.svg", false)).toBe("text");
    expect(comparisonOf("docs/Home.md", false)).toBe("text");
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

describe("file sizes", () => {
  it("reads as people read sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(34 * 1024 + 300)).toBe("34 KB");
    expect(formatBytes(3.4 * 1024 * 1024)).toBe("3.4 MB");
  });

  it("counts the bytes of a data URL", () => {
    expect(dataUrlBytes("data:image/png;base64,iVBORw==")).toBe(4);
    expect(dataUrlBytes("data:image/png;base64,iVBORw0=")).toBe(5);
    expect(dataUrlBytes("data:image/png;base64,iVBORw0K")).toBe(6);
  });

  it("describes an image by its pixels, once known, and its bytes", () => {
    expect(imageFacts({ width: 96, height: 64 }, 2048)).toBe("96 × 64 px · 2.0 KB");
    expect(imageFacts(null, 12)).toBe("12 B");
  });
});
