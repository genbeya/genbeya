import { describe, expect, it } from "vitest";
import { buildFileTree, findNode } from "./file-tree";

describe("buildFileTree", () => {
  const tree = buildFileTree(["b.txt", "src/z.ts", "src/a/x.ts", "A.md", "file10.md", "file9.md"]);

  it("puts folders first and sorts naturally, ignoring case", () => {
    expect(tree.map((n) => n.name)).toEqual(["src", "A.md", "b.txt", "file9.md", "file10.md"]);
    expect(tree[0]!.children!.map((n) => n.name)).toEqual(["a", "z.ts"]);
  });

  it("gives every node its full path", () => {
    expect(tree[0]!.children![0]!.children![0]).toEqual({ name: "x.ts", path: "src/a/x.ts" });
    expect(tree[0]!.path).toBe("src");
  });

  it("finds nodes by path", () => {
    expect(findNode(tree, "src/a")?.path).toBe("src/a");
    expect(findNode(tree, "src/missing")).toBeUndefined();
  });
});
