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

  it("keeps binary files byte for byte, and text as text", async () => {
    const { repository, files } = store();
    const image = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    await files.host.write(files.root, "logo.png", image, true);
    expect(await files.readBytes("logo.png", 100)).toEqual(image);
    expect(repository.worktree.get("logo.png")).toContain("\0");
    await expect(files.read("logo.png")).rejects.toThrow("logo.png is a binary file.");
    await expect(files.readBytes("logo.png", 5)).rejects.toThrow("logo.png is too large to open.");
    // Text that looks like the marker is kept as bytes too, so it reads back as written.
    const lookalike = new TextEncoder().encode("\0binary\0text");
    await files.host.write(files.root, "odd.txt", lookalike, true);
    expect(await files.readBytes("odd.txt", 100)).toEqual(lookalike);
    await files.write("notes.txt", "Ünïcode\n", null);
    expect(repository.worktree.get("notes.txt")).toBe("Ünïcode\n");
  });

  it("runs nothing", async () => {
    const result = await new MemoryHost(store().repository).run("git");
    expect(result.code).toBe(127);
  });
});
