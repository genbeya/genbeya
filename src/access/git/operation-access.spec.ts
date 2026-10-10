import { describe, expect, it } from "vitest";
import { nodeMachine } from "../../platforms/node/node-machine";
import { createRepository, type TestRepository } from "../../testing/repository";
import { LocalHost } from "../hosts/local-host";
import { RepositoryAccess } from "./repository-access";

const host = new LocalHost(nodeMachine());
const open = async (path: string) => new RepositoryAccess(host, await RepositoryAccess.locate(host, path));
const merging = { noFastForward: false, message: "" };

/** Commits `files` on `branch` (created from main when new), then returns to main. */
async function commitOn(repository: TestRepository, branch: string, files: Record<string, string | null>, message = branch) {
  const exists = (await repository.git("branch", "--list", branch)).trim();
  await repository.git("switch", "-q", ...(exists ? [] : ["-c"]), branch);
  for (const [path, content] of Object.entries(files))
    if (content === null) await repository.git("rm", "-q", path);
    else await repository.write(path, content);
  await repository.git("add", "-A");
  await repository.git("commit", "-q", "-m", message);
  await repository.git("switch", "-q", "main");
}

/** A repository whose main and feature both changed src/code.ts. */
async function conflicting(files: Record<string, string | null> = {}) {
  const repository = await createRepository({ "src/code.ts": "one\n", "a.txt": "a\n" });
  await commitOn(repository, "feature", { "src/code.ts": "feature\n", ...files }, "Feature change");
  await commitOn(repository, "main", { "src/code.ts": "main\n" }, "Main change");
  return { repository, repo: await open(repository.root) };
}

describe("OperationAccess", () => {
  it("fast-forwards when it can, or creates a merge commit with a message when asked", async () => {
    const repository = await createRepository();
    const repo = await open(repository.root);
    await commitOn(repository, "feature", { "feature.md": "f" });
    expect(await repo.operations.merge("feature", merging)).toBe("done");
    expect((await repository.git("log", "-1", "--format=%P")).trim().split(" ")).toHaveLength(1);
    await commitOn(repository, "other", { "other.md": "o" });
    expect(await repo.operations.merge("other", { noFastForward: true, message: "Bring in other" })).toBe("done");
    expect((await repository.git("log", "-1", "--format=%P %s")).trim().split(" ")).toHaveLength(5);
    expect((await repository.git("log", "-1", "--format=%s")).trim()).toBe("Bring in other");
    expect(await repo.operations.current("main")).toBeNull();
  });

  it("stops a conflicting merge, reports it, and finishes once the conflict is resolved", async () => {
    const { repository, repo } = await conflicting();
    expect(await repo.operations.merge("feature", merging)).toBe("stopped");
    expect(await repo.operations.current("main")).toEqual({ kind: "merge", source: "feature", target: "main", step: null, steps: null });
    const state = await repo.state();
    expect(state.operation).toMatchObject({ kind: "merge", source: "feature" });
    expect(state.changes).toEqual([{ path: "src/code.ts", index: "U", worktree: "U", conflict: "both-modified" }]);

    const conflict = await repo.operations.conflict("src/code.ts");
    expect(conflict).toMatchObject({ path: "src/code.ts", kind: "both-modified" });
    expect(conflict.text).toMatch(/^<<<<<<< HEAD\nmain\n=======\nfeature\n>>>>>>> feature\n$/);
    await expect(repo.operations.continue()).rejects.toThrow("Resolve the conflicted file first.");
    await expect(repo.operations.skip()).rejects.toThrow("A merge cannot skip anything.");

    await repo.operations.resolve("src/code.ts", { use: "text", text: "main and feature\n" });
    expect(await repo.operations.continue()).toBe("done");
    expect(await repository.read("src/code.ts")).toBe("main and feature\n");
    expect((await repository.git("log", "-1", "--format=%s")).trim()).toBe("Merge branch 'feature'");
    expect((await repository.git("log", "-1", "--format=%P")).trim().split(" ")).toHaveLength(2);
    expect(await repo.operations.current("main")).toBeNull();
  });

  it("takes whole sides, keeps or deletes files one side deleted, and aborts back to the start", async () => {
    const { repository, repo } = await conflicting({ "a.txt": null, "b.txt": "added on feature\n" });
    await commitOn(repository, "main", { "a.txt": "changed on main\n", "b.txt": "added on main\n" }, "More on main");
    const before = (await repository.git("rev-parse", "HEAD")).trim();
    expect(await repo.operations.merge("feature", merging)).toBe("stopped");
    const kinds = Object.fromEntries((await repo.changes()).map((change) => [change.path, change.conflict]));
    expect(kinds).toEqual({ "a.txt": "deleted-by-them", "b.txt": "both-added", "src/code.ts": "both-modified" });

    await repo.operations.resolve("src/code.ts", { use: "theirs" });
    await repo.operations.resolve("b.txt", { use: "ours" });
    await repo.operations.resolve("a.txt", { use: "theirs" });
    expect(await repository.read("src/code.ts")).toBe("feature\n");
    expect(await repository.read("b.txt")).toBe("added on main\n");
    expect(await repository.exists("a.txt")).toBe(false);
    expect(await repo.operations.conflicted()).toBe(false);

    await repo.operations.abort();
    expect(await repo.operations.current("main")).toBeNull();
    expect((await repository.git("rev-parse", "HEAD")).trim()).toBe(before);
    expect(await repository.read("a.txt")).toBe("changed on main\n");
    expect(await repo.changes()).toEqual([]);
  });

  it("keeps the working-tree file or deletes it", async () => {
    const { repository, repo } = await conflicting({ "a.txt": null });
    await commitOn(repository, "main", { "a.txt": "changed on main\n" }, "Change a");
    await repo.operations.merge("feature", merging);
    await repo.operations.resolve("a.txt", { use: "worktree" });
    await repo.operations.resolve("src/code.ts", { use: "delete" });
    expect(await repository.read("a.txt")).toBe("changed on main\n");
    expect(await repository.exists("src/code.ts")).toBe(false);
    expect(await repo.operations.continue()).toBe("done");
  });

  it("shows diff3 conflicts with their ancestor, and no text for binary files", async () => {
    const { repository, repo } = await conflicting({ "bin.dat": "\0feature" });
    await commitOn(repository, "main", { "bin.dat": "\0main" }, "Binary on main");
    await repository.git("config", "merge.conflictStyle", "diff3");
    await repo.operations.merge("feature", merging);
    expect((await repo.operations.conflict("src/code.ts")).text).toContain("||||||| ");
    expect(await repo.operations.conflict("bin.dat")).toEqual({ path: "bin.dat", kind: "both-added", text: null });
    await expect(repo.operations.conflict("a.txt")).rejects.toThrow("a.txt has no conflicts.");
  });

  it("reports failures that leave nothing to resolve", async () => {
    const { repository, repo } = await conflicting();
    await repository.write("src/code.ts", "uncommitted\n");
    await expect(repo.operations.merge("feature", merging)).rejects.toThrow(/local changes/);
    await expect(repo.operations.abort()).rejects.toThrow("No merge, rebase, cherry-pick or revert is in progress.");
  });
});
