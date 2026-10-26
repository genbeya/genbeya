import { describe, expect, it } from "vitest";
import type { Managers } from "../../contracts/manager-contracts";
import type { Snapshot, Theme } from "../../contracts/model";
import { connectManagers, dispatch } from "../../contracts/rpc";
import { createDemoBackend, TERMINAL_UNAVAILABLE } from "./demo-backend";
import { DEMO_FOLDER, NO_FOLDERS } from "./demo-workspace-manager";

/** The demo's managers through the RPC envelope, as the web page calls them, with the sample open. */
async function demo() {
  const backend = createDemoBackend({ networkDelay: 0 });
  const managers: Managers = connectManagers(async (request) => structuredClone(await dispatch(backend, structuredClone(request))));
  const opened = (await managers.workspace.restore([]))!;
  const id = opened.id;
  const snapshot = async () => (await managers.workspace.snapshot(id))!;
  return { managers, id, opened, snapshot, content: managers.content, vc: managers.versionControl };
}

const README = "README.md";
const statusOf = (snapshot: Snapshot, path: string) => snapshot.changes.find((change) => change.path === path);

describe("the demo backend", () => {
  it("opens the sample project with its history, branches, tags, remote and a change to commit", async () => {
    const { opened, vc, id } = await demo();
    const { snapshot } = opened;
    expect(snapshot.location).toEqual({ kind: "local", path: `${DEMO_FOLDER}/genbeya-sample` });
    expect(snapshot.settings.name).toBe("Pocket Weather");
    expect(snapshot.head).toMatchObject({ branch: "main", upstream: "origin/main", ahead: 0, behind: 0 });
    expect(snapshot.branches).toEqual(["fahrenheit", "main"]);
    expect(snapshot.tags).toEqual(["v0.1"]);
    expect(snapshot.remotes).toEqual([{ name: "origin", url: "https://git.example.com/pocket-weather.git" }]);
    expect(snapshot.changes).toEqual([{ path: "src/forecast.ts", index: " ", worktree: "M" }]);
    expect(snapshot.tasks.map((task) => task.id).sort()).toEqual(["PW-1", "PW-2", "PW-3", "PW-4", "PW-5", "PW-6"]);
    expect(snapshot.wiki.map((node) => node.title)).toContain("Architecture");
    expect(snapshot.storage).toEqual({ areas: { wiki: "checkout", tasks: "checkout", settings: "checkout" }, branch: null });
    const log = await vc.log(id, 0, 50);
    expect(log.map((commit) => commit.subject)).toEqual([
      "Explain how to run the report",
      "Put a cloud in front of the sun",
      "Add an icon",
      "Test the conversion",
      "Convert temperatures to Fahrenheit",
      "Plan the first release",
      "Write the wiki",
      "Start Pocket Weather",
    ]);
    expect(log[0]!.refs).toEqual(["HEAD -> main", "origin/main", "origin/HEAD"]);
    expect(log.find((commit) => commit.subject === "Plan the first release")!.refs).toEqual(["tag: v0.1"]);
    expect(log.at(-1)).toMatchObject({ author: "Genbeya", email: "sample@genbeya.invalid" });
  });

  it("starts as a first start: the tour is offered, preferences stay in memory and are validated", async () => {
    const { managers } = await demo();
    expect(await managers.workspace.preferences()).toMatchObject({ tourSeen: false, lastSeenVersion: null });
    expect(await managers.workspace.setPreferences({ theme: "dark" })).toMatchObject({ theme: "dark" });
    await expect(managers.workspace.setPreferences({ theme: "blue" as Theme })).rejects.toThrow("Choose the system, light or dark theme.");
    expect(await managers.workspace.recent()).toMatchObject([{ name: "Pocket Weather" }]);
  });

  it("explains what a web page can't do", async () => {
    const { managers } = await demo();
    await expect(managers.workspace.open({ kind: "local", path: "C:\\code" })).rejects.toThrow(NO_FOLDERS);
    await expect(managers.workspace.clone("https://example.com/x.git", { kind: "local", path: DEMO_FOLDER })).rejects.toThrow("network");
    await expect(managers.workspace.browse({ kind: "ssh", host: "server", path: "" })).rejects.toThrow("WSL or SSH");
    expect(await managers.workspace.distributions()).toEqual([]);
    expect(await managers.terminal.available()).toBe(false);
    await expect(managers.terminal.open("x", 80, 24)).rejects.toThrow(TERMINAL_UNAVAILABLE);
  });

  it("creates another sample from the welcome screen, next to the first", async () => {
    const { managers } = await demo();
    const second = await managers.workspace.createSample({ kind: "local", path: DEMO_FOLDER });
    expect(second.snapshot.location.path).toBe(`${DEMO_FOLDER}/genbeya-sample-2`);
    expect(second.snapshot.branches).toEqual(["main"]);
    expect(second.snapshot.remotes).toEqual([]);
    expect(second.snapshot.changes).toEqual([{ path: "src/forecast.ts", index: " ", worktree: "M" }]);
  });

  describe("content", () => {
    it("creates, edits and comments on tasks, with their activity", async () => {
      const { content, id, snapshot } = await demo();
      const task = await content.createTask(id, {
        title: "Show wind speed",
        status: "todo",
        priority: "medium",
        assignee: "",
        labels: [],
        body: "In km/h.",
        epic: "",
        type: "feature",
      });
      expect(task).toMatchObject({ id: "PW-7", path: "tasks/PW-7.md" });
      const moved = await content.updateTask(id, task.path, { ...task, status: "in-progress", epic: "Release 1.0" }, task.hash);
      expect(moved.path).toBe("tasks/Release 1.0/PW-7.md");
      expect(await content.commentAuthor(id)).toBe("You");
      const commented = await content.addComment(id, moved.path, "On it.");
      expect(commented.comments).toMatchObject([{ author: "You", body: "On it." }]);
      const activity = await content.taskActivity(id, "tasks/PW-2.md");
      expect(activity.map((entry) => entry.subject)).toEqual(["Plan the first release"]);
      expect(statusOf(await snapshot(), "tasks/Release 1.0/PW-7.md")).toMatchObject({ index: "?" });
      await expect(content.setStorage(id, "tasks", "branch")).rejects.toThrow("stay in the checkout");
    });

    it("writes pages, moves them with their links, and finds text", async () => {
      const { content, id } = await demo();
      const page = await content.createPage(id, "docs/Glossary.md");
      await content.write(id, "content", page.path, "# Glossary\n\nSee [[Where files live]].\n", page.hash);
      await expect(content.write(id, "content", page.path, "stale", page.hash)).rejects.toThrow("changed on disk");
      const updates = await content.pageLinks(id, "docs/Where-files-live.md", "docs/Guide/Files.md");
      expect(updates.map((update) => update.path)).toContain("docs/Glossary.md");
      await content.movePage(id, "docs/Where-files-live.md", "docs/Guide/Files.md", { updateLinks: true });
      // The page's title changed with its name, so references by title follow it.
      expect((await content.read(id, "content", "docs/Glossary.md")).content).toContain("[[Files]]");
      const results = await content.search(id, "glossary");
      expect(results.wiki.map((hit) => hit.path)).toEqual(["docs/Glossary.md"]);
      expect(results.wiki[0]!.matches[0]).toMatchObject({ line: 1, text: "# Glossary", ranges: [{ start: 2, end: 10 }] });
      const tasks = await content.search(id, "fahrenheit", { wholeWord: true });
      expect(tasks.tasks.map((hit) => hit.id)).toEqual(["PW-2"]);
      await expect(content.search(id, "(", { regex: true })).rejects.toThrow("Invalid regular expression");
    });

    it("knows the people of the repository", async () => {
      const { content, id } = await demo();
      const { people, me } = await content.people(id);
      // Authors of main's commits go by their mailbox; an assignee without commits on main by the handle written.
      expect(people.map((person) => [person.name, person.handle])).toEqual(
        expect.arrayContaining([
          ["Alex Chen", "alex"],
          ["Genbeya", "sample"],
          ["sam", "sam"],
        ]),
      );
      expect(me).toBeNull();
    });

    it("writes the files for coding agents into the checkout", async () => {
      const { content, id, snapshot } = await demo();
      expect((await content.agentFiles(id, ["agents"])).find((file) => file.target === "agents")).toMatchObject({ state: "missing" });
      expect(await content.addAgentFiles(id, ["agents"])).toEqual([{ path: "AGENTS.md", result: "created" }]);
      expect(statusOf(await snapshot(), "AGENTS.md")).toMatchObject({ index: "?" });
    });
  });

  describe("version control", () => {
    it("keeps the icon's bytes, and serves both versions of it a commit compares", async () => {
      const { vc, content, id } = await demo();
      const [changed] = (await vc.log(id, 0, 50)).filter((commit) => commit.subject === "Put a cloud in front of the sun");
      const diff = await vc.diff(id, "assets/icon.png", { commit: changed!.hash });
      expect(diff).toMatchObject({ binary: true, sizes: [582, 1201] });
      const images = await vc.diffImages(id, "assets/icon.png", { commit: changed!.hash });
      expect(images.original).toMatch(/^data:image\/png;base64,iVBORw0KGgo/);
      expect(images.modified).toBe(await content.image(id, "repo", "assets/icon.png"));
      await expect(content.read(id, "repo", "assets/icon.png")).rejects.toThrow("assets/icon.png is a binary file.");
      await expect(vc.diffImages(id, "README.md", "worktree")).rejects.toThrow("README.md is not a supported image.");
    });

    it("reads a file as committed in a revision", async () => {
      const { vc, id } = await demo();
      const [changed] = (await vc.log(id, 0, 50)).filter((commit) => commit.subject === "Put a cloud in front of the sun");
      const [latest] = await vc.log(id, 0, 1);
      const readme = await vc.fileAt(id, "HEAD", "README.md");
      expect(readme).toEqual({ commit: latest!.hash, content: expect.stringContaining("#") });
      expect(await vc.fileAt(id, latest!.hash.slice(0, 7), "README.md")).toEqual(readme);
      expect(await vc.fileAt(id, "HEAD", "missing.md")).toEqual({ commit: latest!.hash, content: null });
      expect(await vc.fileAt(id, "no-such-tag", "README.md")).toEqual({ commit: null, content: null });
      await expect(vc.fileAt(id, changed!.hash, "assets/icon.png")).rejects.toThrow("assets/icon.png is a binary file.");
      await expect(vc.fileAt(id, "-x", "README.md")).rejects.toThrow("Invalid revision.");
    });

    it("stages lines of a change and commits them, then amends", async () => {
      const { vc, id, snapshot } = await demo();
      const diff = await vc.diff(id, "src/forecast.ts", "worktree");
      expect(diff.changes).toEqual([{ oldStart: 23, oldCount: 0, newStart: 23, newCount: 1 }]);
      await vc.stageLines(id, {
        path: "src/forecast.ts",
        version: diff.version,
        lines: { original: [], modified: [{ from: 23, to: 23 }] },
      });
      expect(statusOf(await snapshot(), "src/forecast.ts")).toEqual({ path: "src/forecast.ts", index: "M", worktree: " " });
      const staged = await vc.diff(id, "src/forecast.ts", "index");
      await vc.unstageLines(id, {
        path: "src/forecast.ts",
        version: staged.version,
        lines: { original: [], modified: [{ from: 23, to: 23 }] },
      });
      expect(statusOf(await snapshot(), "src/forecast.ts")).toMatchObject({ index: " ", worktree: "M" });
      await vc.stage(id, ["src/forecast.ts"]);
      await expect(vc.commit(id, " ", false)).rejects.toThrow("Write a commit message first.");
      await vc.commit(id, "Add Thursday", false);
      expect((await snapshot()).head).toMatchObject({ ahead: 1, behind: 0 });
      await vc.commit(id, "Add Thursday to the forecast", true);
      const [last] = await vc.log(id, 0, 1);
      expect(last).toMatchObject({ subject: "Add Thursday to the forecast", author: "You" });
      expect(await vc.lastCommitMessage(id)).toBe("Add Thursday to the forecast");
      expect((await vc.commitDetail(id, last!.hash)).files).toEqual([{ path: "src/forecast.ts", status: "M" }]);
    });

    it("discards lines, ignores files and stashes changes", async () => {
      const { vc, content, id, snapshot } = await demo();
      const diff = await vc.diff(id, "src/forecast.ts", "worktree");
      await vc.discardLines(id, {
        path: "src/forecast.ts",
        version: diff.version,
        lines: { original: [], modified: [{ from: 23, to: 23 }] },
      });
      expect((await snapshot()).changes).toEqual([]);
      await content.write(id, "repo", "notes.log", "x\n", null);
      await vc.ignore(id, "notes.log", "extension", "");
      expect((await snapshot()).changes).toEqual([{ path: ".gitignore", index: "?", worktree: "?" }]);
      await vc.stash(id, { message: "Ignore logs", includeUntracked: true, keepIndex: false });
      const after = await snapshot();
      // The log file was ignored, so it stayed; without the stashed .gitignore it shows again.
      expect(after.changes).toEqual([{ path: "notes.log", index: "?", worktree: "?" }]);
      expect(after.stashes).toMatchObject([{ index: 0, branch: "main", message: "Ignore logs" }]);
      expect((await vc.stashDetail(id, after.stashes[0]!.hash)).files.map((file) => file.path)).toEqual([".gitignore"]);
      expect(await vc.applyStash(id, after.stashes[0]!.hash, true)).toBe("done");
      const popped = await snapshot();
      expect(popped.stashes).toEqual([]);
      expect(popped.changes).toEqual([{ path: ".gitignore", index: "?", worktree: "?" }]);
    });

    it("merges the branch that conflicts with main, and resolves the conflict", async () => {
      const { vc, id, snapshot } = await demo();
      expect(await vc.merge(id, "fahrenheit", { noFastForward: false, message: "" })).toBe("stopped");
      const stopped = await snapshot();
      expect(stopped.operation).toEqual({ kind: "merge", source: "fahrenheit", target: "main", step: null, steps: null });
      expect(statusOf(stopped, README)).toMatchObject({ conflict: "both-modified" });
      const conflict = await vc.conflict(id, README);
      expect(conflict.text).toContain("<<<<<<< HEAD\nRun `npx tsx src/forecast.ts Zurich` for a three-day report.\n=======\n");
      await expect(vc.cherryPick(id, (await vc.log(id, 0, 1))[0]!.hash)).rejects.toThrow("Finish or abort the merge first.");
      await expect(vc.continueOperation(id)).rejects.toThrow("Resolve the conflicted file first.");
      await vc.resolveConflict(id, README, { use: "theirs" });
      expect(await vc.continueOperation(id)).toBe("done");
      const merged = await snapshot();
      expect(merged.operation).toBeNull();
      // The merge, and the branch's two commits that origin/main lacks.
      expect(merged.head.ahead).toBe(3);
      const [merge] = await vc.log(id, 0, 1);
      expect(merge).toMatchObject({ subject: "Merge branch 'fahrenheit'" });
      expect(merge!.parents).toHaveLength(2);
    });

    it("rebases interactively, resets and undoes commits", async () => {
      const { vc, id, snapshot } = await demo();
      await vc.switchBranch(id, "fahrenheit");
      const base = (await vc.log(id, 0, 10)).find((commit) => commit.subject === "Plan the first release")!.hash;
      const plan = await vc.rebasePlan(id, base);
      expect(plan.commits.map((commit) => commit.subject)).toEqual(["Convert temperatures to Fahrenheit", "Test the conversion"]);
      expect(plan.pushed).toEqual(["origin/fahrenheit"]);
      const [convert, test] = plan.commits;
      await expect(vc.rebaseInteractive(id, base, [], false)).rejects.toThrow("Invalid rebase steps.");
      expect(
        await vc.rebaseInteractive(
          id,
          base,
          [
            { hash: convert!.hash, action: "reword", message: "Convert to Fahrenheit" },
            { hash: test!.hash, action: "fixup" },
          ],
          true,
        ),
      ).toBe("done");
      const rewritten = await vc.log(id, 0, 1);
      expect(rewritten[0]).toMatchObject({ subject: "Convert to Fahrenheit", refs: ["HEAD -> fahrenheit"] });
      expect((await snapshot()).head).toMatchObject({ branch: "fahrenheit", ahead: 1, behind: 2 });
      const resetPlan = await vc.resetPlan(id, base);
      expect(resetPlan).toMatchObject({ branch: "fahrenheit", commits: 1, upstream: "origin/fahrenheit", pushed: 0 });
      const result = await vc.reset(id, base, "hard", resetPlan.head, resetPlan.state);
      expect(result).toEqual({ from: resetPlan.head, to: base });
      await vc.reset(id, result.from, "mixed", base);
      const undone = await vc.undoLastCommit(id, result.from.slice(0, 7));
      expect(undone.to).toBe(base);
      expect((await snapshot()).changes.map((change) => [change.path, change.index])).toEqual([
        ["README.md", "M"],
        ["src/units.test.ts", "A"],
        ["src/units.ts", "A"],
      ]);
    });

    it("rebases onto main, stopping for the conflict, and aborts", async () => {
      const { vc, id, snapshot } = await demo();
      await vc.switchBranch(id, "fahrenheit");
      await expect(vc.rebase(id, "main", false)).rejects.toThrow("Commit or stash your changes first.");
      expect(await vc.rebase(id, "main", true)).toBe("stopped");
      expect((await snapshot()).operation).toMatchObject({ kind: "rebase", source: "fahrenheit", target: "main", step: 1, steps: 2 });
      await vc.abortOperation(id);
      const aborted = await snapshot();
      expect(aborted.head.branch).toBe("fahrenheit");
      // The change set aside for the rebase is back.
      expect(aborted.changes).toEqual([{ path: "src/forecast.ts", index: " ", worktree: "M" }]);
    });

    it("cherry-picks and reverts commits", async () => {
      const { vc, id } = await demo();
      const test = (await vc.log(id, 0, 10)).find((commit) => commit.subject === "Test the conversion")!;
      expect(await vc.cherryPick(id, test.hash)).toBe("done");
      const [picked] = await vc.log(id, 0, 1);
      expect(picked).toMatchObject({ subject: "Test the conversion", author: "Sam Rivera" });
      expect(await vc.revert(id, picked!.hash)).toBe("done");
      expect((await vc.log(id, 0, 1))[0]).toMatchObject({ subject: 'Revert "Test the conversion"', author: "You" });
      await expect(vc.cherryPick(id, picked!.hash)).rejects.toThrow("is already on main");
    });

    it("fetches the commit a teammate pushed, and force pushes only with a fresh lease", async () => {
      const { vc, id, snapshot } = await demo();
      await vc.stage(id, ["src/forecast.ts"]);
      await vc.commit(id, "Add Thursday", false);
      const stale = await vc.forcePushPlan(id, "main", "origin", "main");
      expect(stale.total).toBe(0);
      expect(await vc.push(id, { branch: "main", remote: "origin", remoteBranch: "main", setUpstream: false })).toBe("rejected");
      const lease = { expected: stale.expected, defaultBranch: true };
      await expect(
        vc.push(id, { branch: "main", remote: "origin", remoteBranch: "main", setUpstream: false, force: lease }),
      ).rejects.toThrow("origin/main changed since your last fetch");
      await vc.sync(id, "fetch", "origin");
      expect((await snapshot()).head).toMatchObject({ ahead: 1, behind: 1 });
      await expect(vc.sync(id, "pull", "origin")).rejects.toThrow("Pull with rebase");
      const plan = await vc.forcePushPlan(id, "main", "origin", "main");
      expect(plan).toMatchObject({ total: 1, defaultBranch: true, removed: [{ author: "Sam Rivera" }] });
      const force = { expected: plan.expected, defaultBranch: false };
      await expect(vc.push(id, { branch: "main", remote: "origin", remoteBranch: "main", setUpstream: false, force })).rejects.toThrow(
        "default branch of origin",
      );
      expect(
        await vc.push(id, {
          branch: "main",
          remote: "origin",
          remoteBranch: "main",
          setUpstream: false,
          force: { ...force, defaultBranch: true },
        }),
      ).toBe("done");
      expect((await snapshot()).head).toMatchObject({ ahead: 0, behind: 0 });
    });

    it("pulls a teammate's commit by rebasing local ones onto it", async () => {
      const { vc, id, snapshot } = await demo();
      await vc.stage(id, ["src/forecast.ts"]);
      await vc.commit(id, "Add Thursday", false);
      expect(await vc.pullRebase(id, "origin", false)).toBe("done");
      expect((await snapshot()).head).toMatchObject({ ahead: 1, behind: 0 });
      expect((await vc.log(id, 0, 2)).map((commit) => commit.subject)).toEqual([
        "Add Thursday",
        "Mention Fahrenheit on the forecast source page",
      ]);
    });

    it("publishes new branches and adds remotes, each simulated", async () => {
      const { vc, id, snapshot } = await demo();
      await vc.createBranch(id, "wind");
      expect((await snapshot()).head).toMatchObject({ branch: "wind", upstream: null });
      expect(await vc.push(id, { branch: "wind", remote: "origin", remoteBranch: "wind", setUpstream: true })).toBe("done");
      expect((await snapshot()).head).toMatchObject({ upstream: "origin/wind" });
      await vc.setRemote(id, "backup", "https://example.com/backup.git");
      expect((await vc.pushPlan(id, "wind")).remotes).toMatchObject([
        { remote: "backup", defaultBranch: null, branches: [] },
        { remote: "origin", defaultBranch: "main" },
      ]);
      await vc.deleteRemoteBranch(id, "origin/wind");
      expect((await snapshot()).head.upstream).toBe("origin/wind");
      await vc.createTag(id, "v0.2", "main", "Second");
      await vc.pushTag(id, "v0.2", "origin");
      await expect(vc.createTag(id, "bad..tag", "main", "")).rejects.toThrow("not a valid tag name");
    });
  });
});
