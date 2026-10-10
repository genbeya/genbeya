import { describe, expect, it } from "vitest";
import { WikiEngine } from "./wiki-engine";

const engine = new WikiEngine();
const settings = { wikiRoot: "docs", wikiHome: "Home.md" };

describe("WikiEngine.tree", () => {
  const files = [
    "docs/Home.md",
    "docs/Architecture.md",
    "docs/Architecture/Backend.md",
    "docs/Architecture/Backend/Auth.md",
    "docs/Orphan/Leaf.md",
    "docs/Empty/notes.txt",
    "docs/Getting-started.md",
    "src/code.ts",
  ];
  const tree = engine.tree(files, settings);

  it("lists the home page first, then pages by title", () => {
    expect(tree.map((n) => n.title)).toEqual(["Home", "Architecture", "Getting started", "Orphan"]);
  });

  it("pairs a page with the folder of the same name", () => {
    expect(tree[1]).toMatchObject({ path: "docs/Architecture.md", folder: "docs/Architecture" });
    expect(tree[1]!.children[0]!.children[0]!.path).toBe("docs/Architecture/Backend/Auth.md");
  });

  it("keeps folders without a page if they hold pages", () => {
    expect(tree[3]).toMatchObject({ title: "Orphan", path: null, folder: "docs/Orphan" });
    expect(tree.some((n) => n.title === "Empty")).toBe(false);
  });

  it("is empty when the wiki folder is missing", () => {
    expect(engine.tree(["src/a.ts"], settings)).toEqual([]);
  });

  it("lists the pages in tree order", () => {
    expect(engine.pages(files, settings)).toEqual([
      { title: "Home", path: "docs/Home.md" },
      { title: "Architecture", path: "docs/Architecture.md" },
      { title: "Backend", path: "docs/Architecture/Backend.md" },
      { title: "Auth", path: "docs/Architecture/Backend/Auth.md" },
      { title: "Getting started", path: "docs/Getting-started.md" },
      { title: "Leaf", path: "docs/Orphan/Leaf.md" },
    ]);
  });
});

describe("WikiEngine page rules", () => {
  it("accepts Markdown files inside the wiki folder only", () => {
    expect(engine.isPage("docs/A.md", settings)).toBe(true);
    expect(engine.isPage("docs/A.txt", settings)).toBe(false);
    expect(engine.isPage("src/A.md", settings)).toBe(false);
  });

  it("titles pages after their file names", () => {
    expect(engine.titleOf("docs/Getting-started.md")).toBe("Getting started");
    expect(engine.newPage("docs/Notes/Meeting-notes.md")).toBe("# Meeting notes\n\n");
  });

  it("plans moves together with the subpage folder", () => {
    expect(engine.planMove("docs/A.md", "docs/B.md", true)).toEqual([
      ["docs/A.md", "docs/B.md"],
      ["docs/A", "docs/B"],
    ]);
    expect(engine.planMove("docs/A.md", "docs/B.md", false)).toEqual([["docs/A.md", "docs/B.md"]]);
    expect(engine.planMove("docs/A.md", "docs/A.md", true)).toEqual([]);
  });

  it("refuses to move a page below itself", () => {
    expect(() => engine.planMove("docs/A.md", "docs/A/B.md", true)).toThrow("below itself");
  });

  it("names the subpage folder of a page", () => {
    expect(engine.subpageFolder("docs/A.md")).toBe("docs/A");
  });
});
