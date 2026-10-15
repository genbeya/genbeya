import { promises as fs } from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { cloneRepository, createRemote, createRepository, type TestRepository } from "../../testing/repository";
import { temporaryFolder } from "../../testing/temp";
import { applyDelta, type GitDirectory } from "./git-objects";
import { importRepository } from "./git-import";

const identity = { name: "You", email: "you@example.com" };
const inflate = async (data: Uint8Array) => new Uint8Array(inflateSync(data));

function directory(root: string): GitDirectory {
  return {
    read: (relative) =>
      fs.readFile(path.join(root, relative)).then(
        (data) => new Uint8Array(data),
        () => null,
      ),
    list: (relative) =>
      fs.readdir(path.join(root, relative), { withFileTypes: true }).then(
        (entries) => entries.map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name)),
        () => [],
      ),
  };
}

/** A history with a branch, a merge, an annotated and a light tag, a binary file and a file changed often enough for deltas. */
async function history(): Promise<TestRepository> {
  const repository = await createRepository();
  const commit = async (file: string, content: string | Uint8Array, message: string) => {
    await repository.write(file, content);
    await repository.git("add", "--", file);
    await repository.git("commit", "-q", "-m", message);
  };
  const long = (n: number) => Array.from({ length: 200 }, (_, line) => `line ${line}${line === n ? " changed" : ""}`).join("\n") + "\n";
  for (let n = 0; n < 5; n++) await commit("docs/Long.md", long(n), `Change line ${n}\n\nWith a body.`);
  await repository.git("tag", "-a", "v1", "-m", "Version one");
  await repository.git("switch", "-q", "-c", "feature");
  await commit("src/feature.ts", "export const feature = true;\n", "Add the feature");
  await repository.git("switch", "-q", "main");
  await commit("image.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]), "Add an image");
  await repository.git("merge", "-q", "--no-ff", "-m", "Merge feature", "feature");
  await repository.git("tag", "light");
  return repository;
}

describe("importRepository", () => {
  it("imports a clone's history, refs, remote and checkout as Git has them", async () => {
    const source = await history();
    const remote = await createRemote();
    await source.git("push", "-q", remote, "main", "feature", "v1", "light");
    const clone = await cloneRepository(remote);
    // Packed with deltas, as a server sends them, plus a loose commit on top.
    await clone.git("repack", "-adq", "--depth=50", "--window=50");
    await clone.write("loose.txt", "loose\n");
    await clone.git("add", "loose.txt");
    await clone.git("commit", "-q", "-m", "A loose commit");

    const { repository, statistics } = await importRepository(directory(path.join(clone.root, ".git")), inflate, { identity });

    const log = (await clone.git("log", "--all", "--format=%H %P")).trim().split("\n");
    expect(statistics.commits).toBe(log.length);
    for (const line of log) {
      const [hash, ...parents] = line.split(" ").filter(Boolean);
      expect(repository.commits.get(hash!).parents).toEqual(parents);
    }
    const head = (await clone.git("rev-parse", "HEAD")).trim();
    expect(repository.headCommit()).toBe(head);
    expect(repository.head).toEqual({ branch: "main" });
    expect([...repository.branches.keys()]).toEqual(["main"]);
    expect([...repository.tracking.keys()].sort()).toEqual(["origin/feature", "origin/main"]);
    expect(repository.remoteHeads.get("origin")).toBe("main");
    expect(repository.sync.list()).toEqual([{ name: "origin", url: remote }]);
    expect(repository.upstreams.get("main")).toEqual({ remote: "origin", branch: "main" });
    expect(repository.tags.get("v1")).toEqual({ commit: (await clone.git("rev-parse", "v1^{commit}")).trim(), message: "Version one" });
    expect(repository.tags.get("light")?.commit).toBe((await clone.git("rev-parse", "light")).trim());

    const files = (await clone.git("ls-tree", "-r", "--name-only", "HEAD")).trim().split("\n").sort();
    expect(repository.files()).toEqual(files);
    expect(repository.worktree.get("docs/Long.md")).toBe(await clone.git("show", "HEAD:docs/Long.md"));
    expect(repository.status()).toEqual([]);
    expect(statistics.binaryBlobs).toBe(1);

    const tip = repository.commits.get(head);
    expect(tip.message).toBe("A loose commit");
    expect(tip.author).toMatchObject({ name: "Other", email: "other@example.com" });
    expect(tip.author.date).toBe((await clone.git("log", "-1", "--format=%aI")).trim());
    const first = repository.commits.get((await clone.git("rev-list", "--max-parents=0", "HEAD")).trim());
    expect(first.message).toBe("Initial commit");
    expect(repository.commits.get((await clone.git("rev-parse", "v1^{commit}")).trim()).message).toBe("Change line 4\n\nWith a body.");
  });

  it("treats missing parents as the edge of a shallow clone", async () => {
    const source = await history();
    const root = path.join(await temporaryFolder("shallow-"), "shallow");
    await source.git("clone", "-q", "--depth=2", `file://${source.root.replaceAll("\\", "/")}`, root);
    const { repository, statistics } = await importRepository(directory(path.join(root, ".git")), inflate, { identity });
    expect(statistics.boundaryCommits).toBeGreaterThan(0);
    expect(repository.log(0, 100).length).toBe(statistics.commits);
  });
});

describe("applyDelta", () => {
  it("copies from the base and inserts new bytes", () => {
    const base = new TextEncoder().encode("hello world");
    // Base size 11, result size 11; copy 6 bytes from offset 0, insert "there".
    const delta = new Uint8Array([11, 11, 0x80 | 0x10, 6, 5, ...new TextEncoder().encode("there")]);
    expect(new TextDecoder().decode(applyDelta(base, delta))).toBe("hello there");
  });
});
