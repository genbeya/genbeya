import type { Change } from "../../../../contracts/model";
import { changeTree, type ChangeNode } from "./change-nodes";

const change = (path: string): Change => ({ path, index: " ", worktree: "M" });

/** Folders as "label (count)" with their children, files by path. */
const outline = (nodes: readonly ChangeNode[]): unknown[] =>
  nodes.map((node) => (node.kind === "file" ? node.change.path : { [`${node.label} (${node.changes.length})`]: outline(node.children) }));

describe("changeTree", () => {
  it("puts folders first and chains single folders into one row", () => {
    const tree = changeTree(["README.md", "src/client/app/a.ts", "src/client/app/b.ts", "src/server/main.ts", "docs/x.md"].map(change));
    expect(outline(tree)).toEqual([
      { "docs (1)": ["docs/x.md"] },
      { "src (3)": [{ "client/app (2)": ["src/client/app/a.ts", "src/client/app/b.ts"] }, { "server (1)": ["src/server/main.ts"] }] },
      "README.md",
    ]);
    const [, src] = tree as [ChangeNode, Extract<ChangeNode, { kind: "folder" }>];
    expect(src.path).toBe("src");
    expect((src.children[0] as Extract<ChangeNode, { kind: "folder" }>).path).toBe("src/client/app");
  });

  it("chains a top folder with one folder in it", () => {
    expect(outline(changeTree([change("a/b/c/d.ts")]))).toEqual([{ "a/b/c (1)": ["a/b/c/d.ts"] }]);
  });

  it("does not chain a folder that also holds files", () => {
    expect(outline(changeTree(["a/x.ts", "a/b/y.ts"].map(change)))).toEqual([{ "a (2)": [{ "b (1)": ["a/b/y.ts"] }, "a/x.ts"] }]);
  });

  it("sorts names naturally", () => {
    expect(outline(changeTree(["f10.ts", "f2.ts", "F1.ts"].map(change)))).toEqual(["F1.ts", "f2.ts", "f10.ts"]);
  });
});
