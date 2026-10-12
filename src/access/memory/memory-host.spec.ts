import { describe, expect, it } from "vitest";
import { FileStore } from "../files/file-store";
import { MemoryHost } from "./memory-host";
import { MemoryRepository } from "./memory-repository";

function store() {
  const repository = new MemoryRepository({ identity: { name: "Ada", email: "ada@example.com" } });
  return { repository, files: new FileStore(new MemoryHost(repository), "/demo/repo") };
}

describe("MemoryHost", () => {
  it("serves the working tree to a file store, with versions", async () => {
    const { repository, files } = store();
    const written = await files.write("docs/Home.md", "# Home\n", null);
    expect(repository.worktree.get("docs/Home.md")).toBe("# Home\n");
    expect(await files.read("docs/Home.md")).toEqual(written);
    await expect(files.write("docs/Home.md", "# Again\n", null)).rejects.toThrow("docs/Home.md already exists.");
    await expect(files.write("docs/Home.md", "# Stale\n", "0".repeat(64))).rejects.toThrow("changed on disk");
    await expect(files.read("docs/Missing.md")).rejects.toThrow("docs/Missing.md does not exist.");
    expect(await files.kind("docs")).toBe("dir");
    await expect(files.read("docs")).rejects.toThrow("docs is not a regular file.");
  });

  it("moves files and folders, refusing to replace, and lets empty folders go", async () => {
    const { repository, files } = store();
    await files.write("docs/A.md", "a", null);
    await files.write("docs/A/Sub.md", "sub", null);
    await files.write("docs/B.md", "b", null);
    await expect(files.moveAll([["docs/A.md", "docs/B.md"]])).rejects.toThrow("docs/B.md already exists.");
    await files.moveAll([
      ["docs/A.md", "docs/C.md"],
      ["docs/A", "docs/C"],
    ]);
    expect([...repository.worktree.keys()].sort()).toEqual(["docs/B.md", "docs/C.md", "docs/C/Sub.md"]);
    await files.remove("docs/C/Sub.md");
    await files.removeEmptyFolders("docs/C/Sub.md", "docs");
    expect(await files.kind("docs/C")).toBeNull();
  });

  it("runs nothing", async () => {
    const result = await new MemoryHost(store().repository).run("git");
    expect(result.code).toBe(127);
  });
});
