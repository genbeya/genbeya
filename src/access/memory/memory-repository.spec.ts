import { describe, expect, it } from "vitest";
import { RebaseEngine } from "../../engines/rebase-engine";
import { MemoryRepository } from "./memory-repository";

/** A repository whose clock moves a minute per reading. */
function repository(): MemoryRepository {
  let clock = Date.parse("2026-01-01T10:00:00Z");
  return new MemoryRepository({ identity: { name: "Ada", email: "ada@example.com" }, now: () => new Date((clock += 60_000)) });
}

/** Writes (or with null deletes) files, stages them and commits. */
function commit(repo: MemoryRepository, files: Record<string, string | null>, message = "Change"): string {
  for (const [path, content] of Object.entries(files)) {
    if (content === null) repo.remove(path);
    else repo.write(path, content);
  }
  repo.add(Object.keys(files));
  return repo.commit(message, false).hash;
}

const lines = (...values: string[]) => values.map((value) => `${value}\n`).join("");

/** main with a.txt and b.txt, and a branch `feature` that changes line 2 of a.txt; main changes it too. */
function diverged() {
  const repo = repository();
  const base = commit(repo, { "a.txt": lines("1", "2", "3"), "b.txt": "b\n" }, "Start");
  repo.createBranch("feature", base);
  const ours = commit(repo, { "a.txt": lines("1", "two", "3") }, "Spell two");
  repo.switchTo({ branch: "feature" });
  const theirs = commit(repo, { "a.txt": lines("1", "2!", "3"), "c.txt": "c\n" }, "Shout two");
  repo.switchTo({ branch: "main" });
  return { repo, base, ours, theirs };
}

describe("MemoryRepository", () => {
  describe("status", () => {
    it("tells staged, unstaged and untracked changes apart", () => {
      const repo = repository();
      commit(repo, { "a.txt": "a\n", "b.txt": "b\n", "c.txt": "c\n" });
      repo.write("a.txt", "A\n");
      repo.write("b.txt", "B\n");
      repo.add(["b.txt"]);
      repo.remove("c.txt");
      repo.write("new.txt", "new\n");
      expect(repo.status()).toEqual([
        { path: "a.txt", index: " ", worktree: "M" },
        { path: "b.txt", index: "M", worktree: " " },
        { path: "c.txt", index: " ", worktree: "D" },
        { path: "new.txt", index: "?", worktree: "?" },
      ]);
    });

    it("leaves out ignored files and finds staged renames", () => {
      const repo = repository();
      commit(repo, { ".gitignore": "*.log\n", "old.md": lines("one", "two", "three", "four") });
      repo.write("debug.log", "x");
      repo.remove("old.md");
      repo.write("new.md", lines("one", "two", "three", "4"));
      repo.add(["old.md", "new.md"]);
      expect(repo.status()).toEqual([{ path: "new.md", oldPath: "old.md", index: "R", worktree: " " }]);
      expect(repo.files()).toEqual([".gitignore", "new.md"]);
    });

    it("compares the branch with its upstream", () => {
      const repo = repository();
      const first = commit(repo, { "a.txt": "1\n" });
      repo.tracking.set("origin/main", first);
      repo.upstreams.set("main", { remote: "origin", branch: "main" });
      commit(repo, { "a.txt": "2\n" });
      expect(repo.headState()).toMatchObject({ branch: "main", upstream: "origin/main", ahead: 1, behind: 0 });
    });
  });

  describe("committing", () => {
    it("commits the index, refuses an empty commit, and amends keeping the author", () => {
      const repo = repository();
      const first = commit(repo, { "a.txt": "1\n" }, "First");
      expect(() => repo.commit("Again", false)).toThrow("Nothing to commit");
      repo.write("a.txt", "2\n");
      repo.add(["a.txt"]);
      const amended = repo.commit("First, amended", true);
      expect(amended.parents).toEqual([]);
      expect(amended.author).toEqual(repo.commits.get(first).author);
      expect(repo.log(0, 10).map((entry) => [entry.subject, entry.refs])).toEqual([["First, amended", ["HEAD -> main"]]]);
    });

    it("lists the files a commit changed, with renames", () => {
      const repo = repository();
      commit(repo, { "a.md": lines("1", "2", "3"), "b.md": "b\n" });
      const hash = commit(repo, { "a.md": null, "moved.md": lines("1", "2", "3"), "b.md": "B\n", "c.md": "c\n" });
      expect(repo.commitFiles(hash)).toEqual([
        { path: "b.md", status: "M" },
        { path: "c.md", status: "A" },
        { path: "moved.md", oldPath: "a.md", status: "R" },
      ]);
    });

    it("follows a file's history through renames", () => {
      const repo = repository();
      commit(repo, { "t/A.md": lines("id: A", "status: todo") }, "Create");
      commit(repo, { "t/A.md": lines("id: A", "status: done") }, "Finish");
      commit(repo, { "t/A.md": null, "t/epic/A.md": lines("id: A", "status: done") }, "Move");
      const history = repo.fileHistory("t/epic/A.md", 10);
      expect(history.map((entry) => [entry.subject, entry.path, entry.oldPath])).toEqual([
        ["Move", "t/epic/A.md", "t/A.md"],
        ["Finish", "t/A.md", "t/A.md"],
        ["Create", "t/A.md", null],
      ]);
      expect(history[1]!.before).toBe(lines("id: A", "status: todo"));
    });
  });

  describe("switching", () => {
    it("carries local changes along and refuses to overwrite them", () => {
      const { repo } = diverged();
      repo.write("b.txt", "local\n");
      repo.switchTo({ branch: "feature" });
      expect(repo.worktree.get("b.txt")).toBe("local\n");
      expect(repo.worktree.get("c.txt")).toBe("c\n");
      repo.write("a.txt", "mine\n");
      expect(() => repo.switchTo({ branch: "main" })).toThrow("Your local changes to a.txt would be overwritten by switching");
    });
  });

  describe("merging", () => {
    it("stops for conflicts, resolves them and commits the merge", () => {
      const { repo, ours, theirs } = diverged();
      expect(repo.operations.merge("feature", theirs, { noFastForward: false, message: "" })).toBe("stopped");
      expect(repo.operations.current()).toEqual({ kind: "merge", source: "feature", target: "main", step: null, steps: null });
      expect(repo.status().find((change) => change.path === "a.txt")).toMatchObject({
        index: "U",
        worktree: "U",
        conflict: "both-modified",
      });
      expect(repo.operations.conflict("a.txt").text).toBe(lines("1", "<<<<<<< HEAD", "two", "=======", "2!", ">>>>>>> feature", "3"));
      expect(repo.worktree.get("c.txt")).toBe("c\n");
      expect(() => repo.operations.continue()).toThrow("Resolve the conflicted file first.");
      repo.operations.resolve("a.txt", { use: "theirs" });
      expect(repo.operations.continue()).toBe("done");
      const merge = repo.commits.get(repo.headCommit()!);
      expect(merge.parents).toEqual([ours, theirs]);
      expect(merge.message).toBe("Merge branch 'feature'");
      expect(repo.status()).toEqual([]);
    });

    it("aborts back to HEAD, keeping unrelated local changes", () => {
      const { repo, theirs } = diverged();
      repo.write("b.txt", "local\n");
      repo.operations.merge("feature", theirs, { noFastForward: false, message: "" });
      repo.operations.abort();
      expect(repo.operation).toBeNull();
      expect(repo.status()).toEqual([{ path: "b.txt", index: " ", worktree: "M" }]);
      expect(repo.worktree.has("c.txt")).toBe(false);
    });

    it("fast-forwards unless told not to", () => {
      const repo = repository();
      const base = commit(repo, { "a.txt": "1\n" });
      repo.createBranch("next", base);
      repo.switchTo({ branch: "next" });
      const ahead = commit(repo, { "a.txt": "2\n" });
      repo.switchTo({ branch: "main" });
      expect(repo.operations.merge("next", ahead, { noFastForward: false, message: "" })).toBe("done");
      expect(repo.headCommit()).toBe(ahead);
    });

    it("refuses to overwrite local changes to files it changes", () => {
      const { repo, theirs } = diverged();
      repo.write("a.txt", "local\n");
      expect(() => repo.operations.merge("feature", theirs, { noFastForward: false, message: "" })).toThrow("Your local changes to a.txt");
    });
  });

  describe("rebasing", () => {
    it("replays commits onto another branch, stopping for conflicts", () => {
      const { repo, theirs } = diverged();
      repo.switchTo({ branch: "feature" });
      expect(repo.operations.rebase(repo.resolve("main"), false)).toBe("stopped");
      expect(repo.operations.current()).toEqual({ kind: "rebase", source: "feature", target: "main", step: 1, steps: 1 });
      expect(repo.worktree.get("a.txt")).toContain(`>>>>>>> ${theirs.slice(0, 7)} (Shout two)`);
      repo.operations.resolve("a.txt", { use: "text", text: lines("1", "two!", "3") });
      expect(repo.operations.continue()).toBe("done");
      expect(repo.currentBranch()).toBe("feature");
      const rebased = repo.commits.get(repo.headCommit()!);
      expect(rebased.message).toBe("Shout two");
      expect(rebased.parents).toEqual([repo.resolve("main")]);
      expect(repo.worktree.get("a.txt")).toBe(lines("1", "two!", "3"));
    });

    it("aborts back to where the branch was", () => {
      const { repo, theirs } = diverged();
      repo.switchTo({ branch: "feature" });
      repo.operations.rebase(repo.resolve("main"), false);
      repo.operations.abort();
      expect(repo.currentBranch()).toBe("feature");
      expect(repo.headCommit()).toBe(theirs);
      expect(repo.status()).toEqual([]);
    });

    it("rewrites commits as an interactive rebase's todo says", () => {
      const repo = repository();
      const base = commit(repo, { "a.txt": "0\n" }, "Base");
      const one = commit(repo, { "a.txt": "1\n" }, "One");
      const two = commit(repo, { "b.txt": "2\n" }, "Two");
      const three = commit(repo, { "c.txt": "3\n" }, "Three");
      const plan = repo.operations.plan(base);
      expect(plan.commits.map((entry) => entry.subject)).toEqual(["One", "Two", "Three"]);
      const todo = new RebaseEngine().todo(plan.commits, [
        { hash: one, action: "reword", message: "First" },
        { hash: three, action: "squash" },
        { hash: two, action: "drop" },
      ]);
      expect(repo.operations.rebaseInteractive(base, todo, false)).toBe("done");
      const log = repo.log(0, 10);
      expect(log.map((entry) => entry.subject)).toEqual(["First", "Base"]);
      expect(repo.commits.get(log[0]!.hash).message).toBe("First\n\nThree");
      expect([...repo.headTree().keys()].sort()).toEqual(["a.txt", "c.txt"]);
    });

    it("sets uncommitted changes aside with autostash and brings them back", () => {
      const { repo } = diverged();
      repo.switchTo({ branch: "feature" });
      repo.write("b.txt", "local\n");
      expect(() => repo.operations.rebase(repo.resolve("main"), false)).toThrow("Commit or stash your changes first.");
      repo.operations.rebase(repo.resolve("main"), true);
      repo.operations.resolve("a.txt", { use: "ours" });
      repo.operations.continue();
      expect(repo.worktree.get("b.txt")).toBe("local\n");
      expect(repo.stashList).toEqual([]);
    });
  });

  describe("picking and reverting", () => {
    it("cherry-picks a commit with its author and refuses one already there", () => {
      const { repo, theirs } = diverged();
      repo.switchTo({ branch: "feature" });
      const extra = commit(repo, { "d.txt": "d\n" }, "Add d");
      repo.switchTo({ branch: "main" });
      expect(repo.operations.cherryPick(extra)).toBe("done");
      expect(repo.commits.get(repo.headCommit()!).message).toBe("Add d");
      expect(() => repo.operations.cherryPick(extra)).toThrow("already on this branch");
      expect(repo.operations.cherryPick(theirs)).toBe("stopped");
      expect(repo.operations.current()).toMatchObject({ kind: "cherry-pick", source: "Shout two" });
      expect(repo.operations.skip()).toBe("done");
      expect(repo.status()).toEqual([]);
    });

    it("reverts a commit with a new one", () => {
      const { repo, ours } = diverged();
      expect(repo.operations.revert(ours)).toBe("done");
      const revert = repo.commits.get(repo.headCommit()!);
      expect(revert.message).toBe(`Revert "Spell two"\n\nThis reverts commit ${ours}.`);
      expect(repo.worktree.get("a.txt")).toBe(lines("1", "2", "3"));
    });
  });

  describe("resetting", () => {
    it("keeps, unstages or discards the changes of the commits it leaves", () => {
      const { repo, base, ours } = diverged();
      repo.reset(base, "soft");
      expect(repo.status()).toEqual([{ path: "a.txt", index: "M", worktree: " " }]);
      repo.reset(ours, "soft");
      repo.reset(base, "mixed");
      expect(repo.status()).toEqual([{ path: "a.txt", index: " ", worktree: "M" }]);
      repo.reset(ours, "mixed");
      repo.reset(base, "hard");
      expect(repo.status()).toEqual([]);
      expect(repo.worktree.get("a.txt")).toBe(lines("1", "2", "3"));
    });

    it("keeps unrelated local changes with keep, and refuses to overwrite others", () => {
      const { repo, base, ours } = diverged();
      repo.write("b.txt", "local\n");
      repo.reset(base, "keep");
      expect(repo.worktree.get("b.txt")).toBe("local\n");
      repo.reset(ours, "keep");
      repo.write("a.txt", "local\n");
      expect(() => repo.reset(base, "keep")).toThrow("Keep would overwrite your uncommitted changes to a.txt");
    });
  });

  describe("stashing", () => {
    it("sets changes aside and brings them back, untracked files too", () => {
      const repo = repository();
      commit(repo, { "a.txt": "1\n" }, "Start");
      repo.write("a.txt", "2\n");
      repo.write("new.txt", "new\n");
      repo.stashes.push("", { includeUntracked: true, keepIndex: false });
      expect(repo.status()).toEqual([]);
      const [stash] = repo.stashes.list();
      expect(stash).toMatchObject({ index: 0, branch: "main", message: expect.stringMatching(/^[0-9a-f]{7} Start$/) });
      expect(repo.stashes.detail(stash!.hash).files.map((file) => [file.path, file.status])).toEqual([
        ["a.txt", "M"],
        ["new.txt", "A"],
      ]);
      expect(repo.stashes.apply(stash!.hash, true)).toBe("done");
      expect(repo.status()).toEqual([
        { path: "a.txt", index: " ", worktree: "M" },
        { path: "new.txt", index: "?", worktree: "?" },
      ]);
      expect(repo.stashes.list()).toEqual([]);
    });

    it("keeps a stash that conflicts when popped", () => {
      const repo = repository();
      commit(repo, { "a.txt": "1\n" });
      repo.write("a.txt", "stashed\n");
      repo.stashes.push("try", { includeUntracked: false, keepIndex: false });
      commit(repo, { "a.txt": "committed\n" });
      const [stash] = repo.stashes.list();
      expect(repo.stashes.apply(stash!.hash, true)).toBe("stopped");
      expect(repo.worktree.get("a.txt")).toContain("<<<<<<< Updated upstream");
      expect(repo.stashes.list()).toHaveLength(1);
    });
  });

  describe("remotes", () => {
    function cloned() {
      const repo = repository();
      const first = commit(repo, { "a.txt": "1\n" }, "First");
      repo.sync.set("origin", "https://example.com/repo.git");
      repo.sync.push({ branch: "main", remote: "origin", remoteBranch: "main", setUpstream: true });
      return { repo, first };
    }

    it("publishes, pushes and fetches", () => {
      const { repo, first } = cloned();
      expect(repo.headState()).toMatchObject({ upstream: "origin/main", ahead: 0 });
      expect(repo.sync.defaultBranch("origin")).toBe("main");
      commit(repo, { "a.txt": "2\n" });
      expect(repo.headState().ahead).toBe(1);
      repo.sync.pushBranch("origin", "main");
      expect(repo.remotes.get("origin")!.branches.get("main")).toBe(repo.headCommit());
      expect(repo.tracking.get("origin/main")).not.toBe(first);
    });

    it("rejects pushes the remote has moved past, and force pushes with a lease", () => {
      const { repo, first } = cloned();
      const server = repo.remotes.get("origin")!;
      // Someone else pushed.
      repo.write("b.txt", "b\n");
      repo.add(["b.txt"]);
      const theirs = repo.writeCommit(repo.indexTree(), [first], "Theirs");
      repo.restoreStaged(["b.txt"]);
      repo.remove("b.txt");
      server.branches.set("main", theirs.hash);
      commit(repo, { "a.txt": "mine\n" });
      expect(repo.sync.push({ branch: "main", remote: "origin", remoteBranch: "main", setUpstream: false })).toBe("rejected");
      const lease = { expected: repo.tracking.get("origin/main")! };
      expect(() => repo.sync.push({ branch: "main", remote: "origin", remoteBranch: "main", setUpstream: false, force: lease })).toThrow(
        "origin/main changed since your last fetch",
      );
      repo.sync.fetch("origin");
      expect(repo.headState()).toMatchObject({ ahead: 1, behind: 1 });
      const plan = repo.sync.forcePlan("main", "origin", "main");
      expect(plan).toMatchObject({ expected: theirs.hash, total: 1, defaultBranch: true });
      expect(
        repo.sync.push({ branch: "main", remote: "origin", remoteBranch: "main", setUpstream: false, force: { expected: theirs.hash } }),
      ).toBe("done");
      expect(server.branches.get("main")).toBe(repo.headCommit());
    });

    it("pulls by fast-forwarding, or by rebasing", () => {
      const { repo, first } = cloned();
      const server = repo.remotes.get("origin")!;
      const theirs = repo.writeCommit(
        new Map([
          ["a.txt", "1\n"],
          ["b.txt", "b\n"],
        ]),
        [first],
        "Theirs",
      );
      server.branches.set("main", theirs.hash);
      repo.sync.pull("origin", "main");
      expect(repo.headCommit()).toBe(theirs.hash);
      expect(repo.worktree.get("b.txt")).toBe("b\n");
      const next = repo.writeCommit(
        new Map([
          ["a.txt", "1\n"],
          ["b.txt", "b\n"],
          ["c.txt", "c\n"],
        ]),
        [theirs.hash],
        "Next",
      );
      server.branches.set("main", next.hash);
      commit(repo, { "d.txt": "d\n" }, "Mine");
      expect(() => repo.sync.pull("origin", "main")).toThrow("Pull with rebase");
      expect(repo.sync.pullRebase("origin", "main", false)).toBe("done");
      expect(repo.log(0, 2).map((entry) => entry.subject)).toEqual(["Mine", "Next"]);
    });
  });
});
