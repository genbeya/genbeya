import { describe, expect, it } from "vitest";
import { nodeMachine } from "../../platforms/node/node-machine";
import { cloneRepository, createRemote, createRepository } from "../../testing/repository";
import { temporaryFolder } from "../../testing/temp";
import { decodeLenient } from "../../utilities/bytes";
import { LocalHost } from "../hosts/local-host";
import { RepositoryAccess } from "./repository-access";

const host = new LocalHost(nodeMachine());
const open = async (path: string) => new RepositoryAccess(host, await RepositoryAccess.locate(host, path));
const text = ([before, after]: [Uint8Array, Uint8Array]) => [decodeLenient(before), decodeLenient(after)];

describe("RepositoryAccess.locate", () => {
  it("finds the top folder from a subfolder", async () => {
    const repository = await createRepository();
    expect(await RepositoryAccess.locate(host, host.paths.join(repository.root, "docs"))).toBe(host.paths.normalize(repository.root));
  });

  it("explains folders outside repositories", async () => {
    await expect(RepositoryAccess.locate(host, await temporaryFolder("plain-", true))).rejects.toThrow(
      "This folder is not inside a Git repository.",
    );
  });
});

describe("RepositoryAccess", () => {
  it("reports files, ignoring what .gitignore excludes and what was deleted", async () => {
    const repository = await createRepository();
    await repository.write(".gitignore", "build/\n");
    await repository.write("build/out.js", "");
    await repository.write("new.txt", "");
    await repository.git("rm", "-q", "--cached", "src/code.ts");
    const { files } = await (await open(repository.root)).state();
    expect(files).toContain(".gitignore");
    expect(files).toContain("new.txt");
    expect(files).toContain("src/code.ts");
    expect(files.some((f) => f.startsWith("build/"))).toBe(false);
  });

  it("tells which paths .gitignore excludes, counting tracked files as kept", async () => {
    const repository = await createRepository();
    await repository.write(".gitignore", ".claude/\nsrc/\n");
    const access = await open(repository.root);
    expect(await access.ignored([".claude/skills/x/SKILL.md", "AGENTS.md", "src/code.ts", "src/new.ts"])).toEqual(
      new Set([".claude/skills/x/SKILL.md", "src/new.ts"]),
    );
    expect(await access.ignored(["AGENTS.md"])).toEqual(new Set());
  });

  it("stages literally, unstages renames and discards edits and untracked files", async () => {
    const repository = await createRepository();
    const repo = await open(repository.root);
    await repository.write("[ab].txt", "literal");
    await repository.write("a.txt", "other");
    await repo.stage(["[ab].txt"]);
    let changes = await repo.changes();
    expect(changes.find((c) => c.path === "[ab].txt")?.index).toBe("A");
    expect(changes.find((c) => c.path === "a.txt")?.index).toBe("?");

    await repository.git("mv", "docs/Home.md", "docs/Start.md");
    await repo.unstage(["docs/Start.md", "[ab].txt"]);
    changes = await repo.changes();
    expect(changes.every((c) => c.index === " " || c.index === "?")).toBe(true);

    await repository.write("src/code.ts", "changed");
    await repo.discard(["src/code.ts", "a.txt", "[ab].txt"]);
    expect(await repository.read("src/code.ts")).toBe("export const value = 1;\n");
    expect(await repository.exists("a.txt")).toBe(false);
  });

  it("diffs the working tree, the index and commits", async () => {
    const repository = await createRepository();
    const repo = await open(repository.root);
    await repository.write("src/code.ts", "two");
    expect(text((await repo.diffSides("src/code.ts", "worktree", "src/code.ts", 1000))!)).toEqual(["export const value = 1;\n", "two"]);
    await repo.stage(["src/code.ts"]);
    expect(text((await repo.diffSides("src/code.ts", "index", "src/code.ts", 1000))!)).toEqual(["export const value = 1;\n", "two"]);
    await repo.commit("Two", false);
    const [latest] = await repo.log(0, 1);
    expect(text((await repo.diffSides("src/code.ts", { commit: latest!.hash }, "src/code.ts", 1000))!)).toEqual([
      "export const value = 1;\n",
      "two",
    ]);
    expect(text((await repo.diffSides("gone.ts", "worktree", "gone.ts", 1000))!)).toEqual(["", ""]);
  });

  it("reports diffs with a side over the limit as too large", async () => {
    const repository = await createRepository();
    const repo = await open(repository.root);
    await repository.write("src/code.ts", "x".repeat(100));
    expect(await repo.diffSides("src/code.ts", "worktree", "src/code.ts", 50)).toBeNull();
    await repo.stage(["src/code.ts"]);
    expect(await repo.diffSides("src/code.ts", "index", "src/code.ts", 50)).toBeNull();
    await repo.commit("Big", false);
    const [latest] = await repo.log(0, 1);
    expect(await repo.diffSides("src/code.ts", { commit: latest!.hash }, "src/code.ts", 50)).toBeNull();
  });

  it("shows added files of the first commit and passes real failures through", async () => {
    const repository = await createRepository();
    const repo = await open(repository.root);
    const [first] = await repo.log(0, 1);
    expect(text((await repo.diffSides("src/code.ts", { commit: first!.hash }, "src/code.ts", 1000))!)).toEqual([
      "",
      "export const value = 1;\n",
    ]);
    await expect(repo.diffSides("src", "index", "src", 1000)).rejects.toThrow();
  });

  it("commits, amends and reads history with merge details against the first parent", async () => {
    const repository = await createRepository();
    const repo = await open(repository.root);
    await repository.write("notes.md", "n");
    await repo.stage(["notes.md"]);
    await repo.commit("Add notes", false);
    await repo.commit("Add notes (amended)", true);
    expect(await repo.lastCommitMessage()).toBe("Add notes (amended)");

    await repository.git("switch", "-q", "-c", "feature");
    await repository.write("feature.md", "feature");
    await repository.git("add", ".");
    await repository.git("commit", "-q", "-m", "Feature");
    await repository.git("switch", "-q", "main");
    await repository.write("main.md", "main");
    await repository.git("add", ".");
    await repository.git("commit", "-q", "-m", "Main");
    await repository.git("merge", "-q", "--no-ff", "feature", "-m", "Merge");
    const [merge] = await repo.log(0, 1);
    const detail = await repo.commitDetail(merge!.hash);
    expect(detail.commit.parents).toHaveLength(2);
    expect(detail.files).toEqual([{ status: "A", path: "feature.md" }]);
    expect(await repo.log(1, 2)).toHaveLength(2);
  });

  it("stages and unstages in a repository without commits", async () => {
    const repository = await createRepository({ "a.txt": "a" }, false);
    const repo = await open(repository.root);
    expect((await repo.head()).commit).toBeNull();
    await repo.stage(["a.txt"]);
    await repo.unstage(["a.txt"]);
    expect((await repo.changes())[0]?.index).toBe("?");
    expect(await repo.log(0, 10)).toEqual([]);
    expect(await repo.lastCommitMessage()).toBe("");
  });

  it("validates branch names with git's rules", async () => {
    const repo = await open((await createRepository()).root);
    expect(await repo.isValidBranchName("feature/x")).toBe(true);
    expect(await repo.isValidBranchName("bad..name")).toBe(false);
  });

  it("works with branches, remotes and remote-only branches", async () => {
    const repository = await createRepository();
    const repo = await open(repository.root);
    const remote = await createRemote();
    await repo.setRemote("origin", remote);
    await repo.sync("push", "origin", "main");
    await repo.createBranch("feature/x");
    await repo.sync("push", "origin", "feature/x");
    await repo.switchBranch("main");

    const clone = await cloneRepository(remote);
    const theirs = await open(clone.root);
    expect((await theirs.state()).remoteBranches).toEqual(["origin/feature/x"]);
    await theirs.switchBranch("origin/feature/x");
    expect(await theirs.head()).toMatchObject({ branch: "feature/x", upstream: "origin/feature/x" });
    await theirs.switchBranch("main");
    await clone.write("remote.md", "from clone");
    await clone.git("add", ".");
    await clone.git("commit", "-q", "-m", "Remote");
    await theirs.sync("push", "origin", "main");

    await repo.sync("fetch", "origin", null);
    expect((await repo.head()).behind).toBe(1);
    await repo.sync("pull", "origin", "main");
    expect(await repository.read("remote.md")).toBe("from clone");
    await expect(repo.sync("push", "origin", null)).rejects.toThrow("Switch to a branch first.");

    await repo.setRemote("origin", remote + "-moved");
    expect((await repo.state()).remotes).toEqual([{ name: "origin", url: remote + "-moved" }]);
    await repo.removeRemote("origin");
    expect((await repo.state()).remotes).toEqual([]);
  });

  it("pulls and pushes a branch through its upstream, even one with another name", async () => {
    const repository = await createRepository();
    const repo = await open(repository.root);
    const remote = await createRemote();
    await repo.setRemote("origin", remote);
    await repo.sync("push", "origin", "main");
    const clone = await cloneRepository(remote);
    await clone.git("switch", "-q", "--create", "mine", "--track", "origin/main");
    const theirs = await open(clone.root);

    await repository.write("pulled.md", "pulled");
    await repo.stage(["pulled.md"]);
    await repo.commit("Pulled", false);
    await repo.sync("push", "origin", "main");
    await theirs.sync("pull", "origin", "mine");
    expect(await clone.read("pulled.md")).toBe("pulled");

    await clone.write("pushed.md", "pushed");
    await theirs.stage(["pushed.md"]);
    await theirs.commit("Pushed", false);
    await theirs.sync("push", "origin", "mine");
    const heads = await clone.git("ls-remote", "--heads", "origin");
    expect(heads).not.toContain("refs/heads/mine");
    expect(heads).toContain(`${(await clone.git("rev-parse", "HEAD")).trim()}\trefs/heads/main`);
    expect(await theirs.head()).toMatchObject({ branch: "mine", upstream: "origin/main", ahead: 0 });

    // Pushing to another remote leaves the upstream alone.
    await theirs.setRemote("backup", await createRemote());
    await theirs.sync("push", "backup", "mine");
    expect(await clone.git("ls-remote", "--heads", "backup")).toContain("refs/heads/mine");
    expect(await theirs.head()).toMatchObject({ upstream: "origin/main" });
  });
});
