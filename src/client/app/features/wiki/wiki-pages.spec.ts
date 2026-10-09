import type { WikiNode } from "../../../../contracts/model";
import { findPage, flattenPages, nodeKey, pageName, pageNameProblem, pagePath, subpagesOf } from "./wiki-pages";

const wiki: WikiNode[] = [
  { title: "Home", path: "docs/Home.md", folder: null, children: [] },
  {
    title: "Architecture",
    path: "docs/Architecture.md",
    folder: "docs/Architecture",
    children: [{ title: "Backend", path: "docs/Architecture/Backend.md", folder: null, children: [] }],
  },
  {
    title: "Notes",
    path: null,
    folder: "docs/Notes",
    children: [{ title: "Week 1", path: "docs/Notes/Week-1.md", folder: null, children: [] }],
  },
];

describe("wiki pages", () => {
  it("finds pages and folders with the nodes above them", () => {
    expect(findPage(wiki, "docs/Architecture/Backend.md")).toEqual({ node: wiki[1]!.children[0], trail: [wiki[1]] });
    expect(findPage(wiki, "docs/Notes")?.node.title).toBe("Notes");
    expect(findPage(wiki, "docs/Nope.md")).toBeNull();
  });

  it("flattens pages with their trail", () => {
    expect(flattenPages(wiki).map((p) => [p.title, p.trail.join("/")])).toEqual([
      ["Home", ""],
      ["Architecture", ""],
      ["Backend", "Architecture"],
      ["Week 1", "Notes"],
    ]);
  });

  it("names and keys nodes", () => {
    expect(pageName("docs/Guide/Setup.md", "docs")).toBe("Guide/Setup");
    expect(nodeKey(wiki[2]!)).toBe("folder:docs/Notes");
    expect(subpagesOf(wiki[2]!.children)).toEqual([{ title: "Week 1", path: "docs/Notes/Week-1.md", children: [] }]);
  });

  it("turns typed names into page paths", () => {
    expect(pagePath("docs", "/Guide/Setup.md/")).toBe("docs/Guide/Setup.md");
    expect(pageNameProblem("Guide/Setup")).toBeNull();
    expect(pageNameProblem("../x")).toBeTruthy();
    expect(pageNameProblem("a:b")).toBeTruthy();
  });
});
