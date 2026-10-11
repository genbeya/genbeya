import { describe, expect, it, vi } from "vitest";
import { nodeMachine } from "../../platforms/node/node-machine";
import { cloneRepository, createRemote, createRepository } from "../../testing/repository";
import { LocalHost } from "../hosts/local-host";
import { RepositoryAccess } from "./repository-access";
import { restage } from "./staging-access";

const host = new LocalHost(nodeMachine());
const open = async (path: string) => new RepositoryAccess(host, await RepositoryAccess.locate(host, path));
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

describe("restage", () => {
  it("takes index letters from another comparison, keeping conflicts and working-tree letters", () => {
    expect(
      restage(
        [
          { path: "a", index: " ", worktree: "M" },
          { path: "b", index: "M", worktree: " " },
          { path: "c", index: "U", worktree: "U", conflict: "both-modified" },
          { path: "d", index: "R", worktree: " ", oldPath: "old-d" },
          { path: "n", index: "?", worktree: "?" },
        ],
        [
          { path: "a", status: "A" },
          { path: "e", status: "R", oldPath: "old-e" },
        ],
      ),
    ).toEqual([
      { path: "a", index: "A", worktree: "M" },
      { path: "c", index: "U", worktree: "U", conflict: "both-modified" },
      { path: "e", oldPath: "old-e", index: "R", worktree: " " },
      { path: "n", index: "?", worktree: "?" },
    ]);
  });
});

describe("StagingAccess", () => {
  it("compares with HEAD, its first parent, or the empty tree", async () => {
    const repository = await createRepository({ "a.txt": "a\n" }, false);
    const { staging } = await open(repository.root);
    expect(await staging.base("head")).toBe(EMPTY_TREE);
    await expect(staging.base("parent")).rejects.toThrow("There is no commit to amend yet.");
    expect(await staging.amending()).toBeNull();
    await repository.git("add", ".");
    await repository.git("commit", "-q", "-m", "First");
    expect(await staging.base("head")).toBe("HEAD");
    expect(await staging.base("parent")).toBe(EMPTY_TREE);
    expect(await staging.staged(EMPTY_TREE)).toEqual([{ path: "a.txt", status: "A" }]);
    await repository.git("commit", "-q", "--allow-empty", "-m", "Second");
    expect(await staging.base("parent")).toBe((await repository.git("rev-parse", "HEAD~1")).trim());
    expect(await staging.amending()).toEqual({ commit: expect.any(String), parent: expect.any(String), merge: false, pushed: [] });
  });

  it("names the remote branches that have the commit being amended, without the remotes' HEADs", async () => {
    const clone = await cloneRepository(await createRemote());
    await clone.write("a.txt", "a\n");
    await clone.git("add", ".");
    await clone.git("commit", "-q", "-m", "First");
    await clone.git("push", "-q", "origin", "main");
    await clone.git("remote", "set-head", "origin", "main");
    const { staging, git } = await open(clone.root);
    expect((await staging.amending())!.pushed).toEqual(["origin/main"]);
    // Polled with every snapshot: looked up again only once HEAD or a remote branch moved.
    const run = vi.spyOn(git, "run");
    expect((await staging.amending())!.pushed).toEqual(["origin/main"]);
    expect(run.mock.calls.map(([args]) => args[0])).toEqual(["rev-parse"]);
    await clone.git("commit", "-q", "--allow-empty", "-m", "Second");
    expect((await staging.amending())!.pushed).toEqual([]);
    await clone.git("push", "-q", "origin", "main");
    expect((await staging.amending())!.pushed).toEqual(["origin/main"]);
  });

  it("diffs files with plain prefixes whatever the configuration says", async () => {
    const repository = await createRepository({ "a b.txt": "a\n" });
    await repository.git("config", "diff.mnemonicPrefix", "true");
    await repository.git("config", "diff.noprefix", "true");
    await repository.write("a b.txt", "b\n");
    const { staging } = await open(repository.root);
    const diff = await staging.diff("a b.txt", "a b.txt", null);
    expect(diff).toContain("--- a/a b.txt\t\n+++ b/a b.txt\t\n");
    await repository.git("add", ".");
    expect(await staging.diff("a b.txt", "a b.txt", "HEAD")).toContain("--- a/a b.txt\t\n+++ b/a b.txt\t\n");
  });

  it("applies patches to the index and the working tree, and leaves no patch file behind", async () => {
    const repository = await createRepository({ "a.txt": "a\n" });
    await repository.write("a.txt", "b\n");
    const { staging } = await open(repository.root);
    const patch = await staging.diff("a.txt", "a.txt", null);
    await staging.apply(patch, { cached: true, reverse: false });
    expect(await repository.git("show", ":a.txt")).toBe("b\n");
    await expect(staging.apply(patch, { cached: true, reverse: false })).rejects.toThrow("patch does not apply");
    await staging.apply(patch, { cached: false, reverse: true });
    expect(await repository.read("a.txt")).toBe("a\n");
    expect(await repository.exists(".git/gitdesk.patch")).toBe(false);
  });

  it("adds untracked files with intent, resets index entries and stops tracking", async () => {
    const repository = await createRepository({ "a.txt": "a\n" });
    await repository.write("new.txt", "new\n");
    await repository.write("a.txt", "b\n");
    await repository.git("add", "a.txt");
    const { staging } = await open(repository.root);
    await staging.intendToAdd("new.txt");
    expect(await staging.diff("new.txt", "new.txt", null)).toContain("new file mode 100644\n");
    await staging.reset("HEAD", ["a.txt"]);
    expect(await repository.git("show", ":a.txt")).toBe("a\n");
    await staging.untrack(["new.txt", "a.txt"], true);
    expect(await repository.git("ls-files")).toBe("");
    expect(await repository.read("new.txt")).toBe("new\n");
  });
});
