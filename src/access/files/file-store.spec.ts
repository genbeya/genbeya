import { describe, expect, it } from "vitest";
import { nodeMachine } from "../../platforms/node/node-machine";
import { temporaryFolder } from "../../testing/temp";
import { sha256 } from "../../utilities/bytes";
import { LocalHost } from "../hosts/local-host";
import { FileStore, TEXT_LIMIT } from "./file-store";

const store = async () => new FileStore(new LocalHost(nodeMachine()), await temporaryFolder("files-"));

describe("FileStore", () => {
  it("creates files only when they do not exist", async () => {
    const files = await store();
    const created = await files.write("a.md", "one", null);
    expect(created).toEqual({ path: "a.md", content: "one", hash: sha256("one") });
    await expect(files.write("a.md", "two", null)).rejects.toThrow("a.md already exists.");
  });

  it("updates files at the expected version and rejects stale edits", async () => {
    const files = await store();
    const first = await files.write("a.md", "one", null);
    const second = await files.write("a.md", "two", first.hash);
    expect((await files.read("a.md")).content).toBe("two");
    await expect(files.write("a.md", "three", first.hash)).rejects.toThrow("a.md changed on disk.");
    await files.remove("a.md");
    await expect(files.write("a.md", "again", second.hash)).rejects.toThrow("changed on disk");
  });

  it("limits file sizes", async () => {
    const files = await store();
    await expect(files.write("big.md", "x".repeat(TEXT_LIMIT + 1), null)).rejects.toThrow("2 MiB");
  });

  it("reports versions of missing files as null", async () => {
    expect(await (await store()).versionOf("missing.md")).toBeNull();
  });

  it("reads many files, separating missing from undecodable ones", async () => {
    const files = await store();
    await files.write("ok.md", "fine", null);
    await files.host.write(files.root, "bin.md", new Uint8Array([0, 1]), false);
    const [ok, missing, binary] = await files.readMany(["ok.md", "missing.md", "bin.md"]);
    expect(ok).toMatchObject({ content: "fine" });
    expect(missing).toBeNull();
    expect(binary).toBeInstanceOf(Error);
    expect((binary as Error).message).toBe("bin.md is a binary file.");
  });
});
