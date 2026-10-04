import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Workspace } from "../core/workspace.js";
import { parseStatusV2 } from "../core/git.js";
import { printfFormat, quote } from "../core/shell-host.js";
import { fromWindowsPath, wslDistros } from "../core/hosts.js";
import { nextTaskId } from "../core/tasks.js";
import { prefixFor } from "../core/settings.js";

const exec = promisify(execFile);
const base = path.resolve(".test-work");

async function repo(t: any, files: Record<string, string> = {}, commit = true) {
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, "core-"));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => undefined));
  const git = (...args: string[]) => exec("git", args, { cwd: root });
  await git("init", "-q", "-b", "main");
  await git("config", "user.name", "Test");
  await git("config", "user.email", "test@example.com");
  await git("config", "core.autocrlf", "false");
  const all = {
    ".gitdesk.yml": "name: Test Project\ntaskPrefix: TP\n",
    "docs/Home.md": "# Home\n",
    "docs/Architecture.md": "# Architecture\n",
    "docs/Architecture/Backend.md": "# Backend\n",
    "docs/Architecture/Backend/Auth.md": "# Auth\n",
    "src/code.ts": "export const value = 1;\n",
    ...files,
  };
  for (const [p, s] of Object.entries(all)) {
    await fs.mkdir(path.dirname(path.join(root, p)), { recursive: true });
    await fs.writeFile(path.join(root, p), s);
  }
  if (commit) {
    await git("add", ".");
    await git("commit", "-q", "-m", "Initial commit");
  }
  const ws = await Workspace.open({ kind: "local", path: root });
  t.after(() => ws.dispose());
  return { root, git, ws };
}

const input = {
  title: "Build it",
  status: "backlog",
  priority: "high",
  assignee: "alice",
  labels: ["backend"],
  body: "Useful work.\n\n- [ ] Done\n",
};

test("unit: helpers", () => {
  assert.equal(prefixFor("GitDesk"), "GD");
  assert.equal(prefixFor("my project"), "MP");
  assert.equal(prefixFor("atlas"), "ATL");
  assert.equal(nextTaskId("GD", ["GENBEYA-2", "GENBEYA-10", "X-99", "uuid"]), "GENBEYA-11");
  assert.equal(quote("it's"), `'it'\\''s'`);
  assert.equal(printfFormat(Buffer.from("a%b'\\\n")), "a\\045b\\047\\134\\012");
  assert.deepEqual(fromWindowsPath("\\\\wsl.localhost\\Ubuntu\\home\\me"), {
    kind: "wsl",
    distro: "Ubuntu",
    path: "/home/me",
  });
  assert.deepEqual(fromWindowsPath("C:\\code"), { kind: "local", path: "C:\\code" });
  const { head, changes } = parseStatusV2(
    "# branch.oid abcdef1234\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -1\0" +
      "1 .M N... 100644 100644 100644 a a file with spaces.md\0" +
      "2 R. N... 100644 100644 100644 a a R100 new name.md\0old name.md\0? untracked.txt\0",
  );
  assert.deepEqual(head, { branch: "main", commit: "abcdef1", upstream: "origin/main", ahead: 2, behind: 1 });
  assert.deepEqual(changes, [
    { path: "file with spaces.md", index: " ", worktree: "M" },
    { path: "new name.md", oldPath: "old name.md", index: "R", worktree: " " },
    { path: "untracked.txt", index: "?", worktree: "?" },
  ]);
});

test("wiki pairs pages with folders and lists the home page first", async (t) => {
  const { ws, root } = await repo(t, { "docs/Orphan/Leaf.md": "# Leaf\n", "docs/Empty/notes.txt": "" });
  const s = (await ws.snapshot())!;
  assert.deepEqual(s.wiki.map((n) => n.title), ["Home", "Architecture", "Orphan"]);
  const architecture = s.wiki[1];
  assert.equal(architecture.path, "docs/Architecture.md");
  assert.equal(architecture.children[0].children[0].path, "docs/Architecture/Backend/Auth.md");
  assert.equal(s.wiki[2].path, null);
  assert.equal(s.settings.name, "Test Project");
  await fs.writeFile(path.join(root, ".gitignore"), "build/\n");
  await fs.mkdir(path.join(root, "build"));
  await fs.writeFile(path.join(root, "build/out.js"), "");
  const names = (await ws.snapshot())!.files.map((f) => f.name);
  assert.ok(names.includes(".gitignore") && !names.includes("build"));
});

test("snapshot reports no change for an unchanged repository", async (t) => {
  const { ws, root } = await repo(t);
  const first = (await ws.snapshot())!;
  assert.equal(await ws.snapshot(first.version), null);
  await fs.writeFile(path.join(root, "new.txt"), "x");
  assert.notEqual(await ws.snapshot(first.version), null);
});

test("pages are created, moved with their subpages, and deleted", async (t) => {
  const { ws } = await repo(t);
  const page = await ws.createPage("docs/Guides/Setup.md");
  assert.equal(page.content, "# Setup\n\n");
  await assert.rejects(ws.createPage("docs/Home.md"), /already exists/);
  await assert.rejects(ws.createPage("src/x.md"), /inside docs/);
  assert.equal(await ws.movePage("docs/Architecture.md", "docs/Design.md"), "docs/Design.md");
  const s = (await ws.snapshot())!;
  const design = s.wiki.find((n) => n.title === "Design")!;
  assert.equal(design.children[0].path, "docs/Design/Backend.md");
  await assert.rejects(ws.deletePage("docs/Design.md"), /subpages/);
  await assert.rejects(ws.movePage("docs/Design.md", "docs/Design/Inner.md"), /below itself/);
  assert.equal((await ws.read("content", "docs/Design.md")).content, "# Architecture\n");
  await ws.deletePage("docs/Guides/Setup.md");
  await assert.rejects(ws.read("content", "docs/Guides/Setup.md"), /does not exist/);
  await ws.write("repo", "notes/new.txt", "", null);
  await ws.remove("repo", "notes/new.txt");
  await assert.rejects(ws.remove("repo", "src"), /not a regular file/);
  await assert.rejects(ws.remove("repo", ".git/config"));
});

test("tasks get sequential IDs and keep comments and unknown fields", async (t) => {
  const { ws, root } = await repo(t);
  const first = await ws.createTask(input);
  const second = await ws.createTask({ ...input, title: "Second" });
  assert.equal(first.id, "TP-1");
  assert.equal(second.id, "TP-2");
  assert.equal(first.path, "tasks/TP-1.md");
  assert.equal(first.body, input.body);
  const raw = await ws.read("content", first.path);
  await ws.write("content", first.path, raw.content.replace("title:", "# keep me\nestimate: 3\ntitle:"), raw.hash);
  const current = (await ws.snapshot())!.tasks.find((x) => x.id === "TP-1")!;
  const updated = await ws.updateTask(first.path, { ...input, status: "done", labels: [] }, current.hash);
  assert.equal(updated.status, "done");
  assert.deepEqual(updated.labels, []);
  const content = await fs.readFile(path.join(root, first.path), "utf8");
  assert.match(content, /# keep me/);
  assert.match(content, /estimate: 3/);
  assert.doesNotMatch(content, /labels/);
  await assert.rejects(ws.updateTask(first.path, input, current.hash), /changed on disk/);
  await ws.deleteTask(second.path);
  assert.deepEqual((await ws.snapshot())!.tasks.map((x) => x.id), ["TP-1"]);
  await assert.rejects(ws.createTask({ ...input, status: "nope" }), /workflow states/);
});

test("broken tasks, duplicate IDs and broken settings become warnings", async (t) => {
  const task = "---\nid: X-1\ntitle: T\nstatus: todo\n---\n";
  const { ws, root } = await repo(t, {
    "tasks/bad.md": "---\nid: [broken\n---\n",
    "tasks/a.md": task,
    "tasks/b.md": task,
  });
  let s = (await ws.snapshot())!;
  assert.equal(s.tasks.length, 2);
  assert.match(s.warnings.join("\n"), /bad\.md: Invalid YAML/);
  assert.match(s.warnings.join("\n"), /X-1 is also used by tasks\/a\.md/);
  await fs.writeFile(path.join(root, ".gitdesk.yml"), "name: [broken\nextra: 1\n");
  s = (await ws.snapshot())!;
  assert.equal(s.settings.wikiRoot, "docs");
  assert.match(s.warnings[0], /\.gitdesk\.yml/);
  await ws.saveSettings({ ...s.settings, name: "Fixed" }, s.settingsHash);
  assert.equal((await ws.snapshot())!.settings.name, "Fixed");
});

test("settings preserve unknown keys and reject stale or invalid saves", async (t) => {
  const { ws, root } = await repo(t, { ".gitdesk.yml": "# comment\nname: A\ncustom: true\n" });
  const s = (await ws.snapshot())!;
  await ws.saveSettings({ ...s.settings, name: "B", statuses: ["open", "closed"] }, s.settingsHash);
  const text = await fs.readFile(path.join(root, ".gitdesk.yml"), "utf8");
  assert.match(text, /# comment/);
  assert.match(text, /custom: true/);
  await assert.rejects(ws.saveSettings(s.settings, s.settingsHash), /changed on disk/);
  const next = (await ws.snapshot())!;
  await assert.rejects(ws.saveSettings({ ...next.settings, wikiRoot: "tasks" }, next.settingsHash), /contain each other/);
  await assert.rejects(ws.saveSettings({ ...next.settings, statuses: [] }, next.settingsHash), /workflow states/);
});

test("paths are validated, literal, and never follow links", async (t) => {
  const { ws, root } = await repo(t);
  for (const p of ["../x", "docs/../../x", ".git/config", ".git./config", "/etc/passwd", "docs\\Home.md", ""])
    await assert.rejects(ws.write("repo", p, "bad", null));
  if (process.platform === "win32")
    for (const p of ["GIT~1/config", "code.ts:stream", "docs/Home.md.", "con"])
      await assert.rejects(ws.write("repo", p, "bad", null));
  await fs.writeFile(path.join(root, "binary.bin"), Buffer.from([0, 1, 2]));
  await assert.rejects(ws.read("repo", "binary.bin"), /binary/);
  try {
    await fs.symlink(path.join(root, "docs"), path.join(root, "linked"), "junction");
    await assert.rejects(ws.read("repo", "linked/Home.md"), /symbolic link/);
    await assert.rejects(ws.write("repo", "linked/new.md", "x", null), /symbolic link/);
  } catch (error: any) {
    if (error.code !== "EPERM") throw error;
  }
  await fs.writeFile(path.join(root, "[ab].txt"), "literal");
  await fs.writeFile(path.join(root, "a.txt"), "other");
  await ws.stage(["[ab].txt"]);
  const changes = (await ws.snapshot())!.changes;
  assert.equal(changes.find((c) => c.path === "[ab].txt")!.index, "A");
  assert.equal(changes.find((c) => c.path === "a.txt")!.index, "?");
});

test("stage, unstage, discard, commit, amend and diff", async (t) => {
  const { ws, root, git } = await repo(t);
  const file = await ws.read("repo", "src/code.ts");
  await ws.write("repo", file.path, "export const value = 2;\n", file.hash);
  await fs.writeFile(path.join(root, "scratch.txt"), "temp");
  let diff = await ws.diff("src/code.ts", "worktree");
  assert.match(diff.original, /1/);
  assert.match(diff.modified, /2/);
  await ws.stage(["src/code.ts"]);
  diff = await ws.diff("src/code.ts", "index");
  assert.match(diff.modified, /2/);
  await ws.unstage(["src/code.ts"]);
  assert.equal((await ws.snapshot())!.changes.find((c) => c.path === "src/code.ts")!.index, " ");
  await ws.discard(["scratch.txt", "src/code.ts"]);
  assert.deepEqual((await ws.snapshot())!.changes, []);
  await ws.write("repo", "notes.md", "n\n", null);
  await ws.stage(["notes.md"]);
  await ws.commit("Add notes", false);
  await ws.commit("Add notes (amended)", true);
  assert.equal(await ws.lastCommitMessage(), "Add notes (amended)");
  assert.equal((await ws.log(0, 10)).length, 2);
  await git("mv", "notes.md", "renamed notes.md");
  await ws.unstage(["renamed notes.md"]);
  assert.ok((await ws.snapshot())!.changes.every((c) => c.index === " " || c.index === "?"));
});

test("history lists merge files against the first parent", async (t) => {
  const { ws, root, git } = await repo(t);
  await git("switch", "-q", "-c", "feature");
  await fs.writeFile(path.join(root, "feature.md"), "feature");
  await git("add", ".");
  await git("commit", "-q", "-m", "Feature");
  await git("switch", "-q", "main");
  await fs.writeFile(path.join(root, "main.md"), "main");
  await git("add", ".");
  await git("commit", "-q", "-m", "Main");
  await git("merge", "-q", "--no-ff", "feature", "-m", "Merge");
  const [merge] = await ws.log(0, 1);
  const detail = await ws.commitDetail(merge.hash);
  assert.equal(detail.commit.parents.length, 2);
  assert.deepEqual(detail.files, [{ status: "A", path: "feature.md" }]);
  const diff = await ws.diff("feature.md", { commit: merge.hash });
  assert.equal(diff.modified, "feature");
  assert.equal((await ws.log(1, 2)).length, 2);
});

test("unborn repositories stage and unstage", async (t) => {
  const { ws } = await repo(t, {}, false);
  const s = (await ws.snapshot())!;
  assert.equal(s.head.branch, "main");
  assert.equal(s.head.commit, null);
  await ws.stage(["src/code.ts"]);
  await ws.unstage(["src/code.ts"]);
  assert.equal((await ws.snapshot())!.changes.find((c) => c.path === "src/code.ts")!.index, "?");
});

test("branches, remotes and remote-only branches", async (t) => {
  const { ws, root } = await repo(t);
  const bare = root + "-remote.git";
  t.after(() => fs.rm(bare, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => undefined));
  await exec("git", ["init", "-q", "--bare", "-b", "main", bare]);
  await ws.setRemote("origin", bare);
  await ws.sync("push", "origin");
  await ws.createBranch("feature/x");
  await ws.sync("push", "origin");
  await ws.switchBranch("main");
  const clone = root + "-clone";
  t.after(() => fs.rm(clone, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => undefined));
  await exec("git", ["clone", "-q", bare, clone]);
  const other = await Workspace.open({ kind: "local", path: clone });
  t.after(() => other.dispose());
  let s = (await other.snapshot())!;
  assert.deepEqual(s.remoteBranches, ["origin/feature/x"]);
  await other.switchBranch("origin/feature/x");
  s = (await other.snapshot())!;
  assert.equal(s.head.branch, "feature/x");
  assert.equal(s.head.upstream, "origin/feature/x");
  await other.switchBranch("main");
  await fs.writeFile(path.join(clone, "remote.md"), "from clone");
  await exec("git", ["add", "."], { cwd: clone });
  await exec("git", ["-c", "user.name=O", "-c", "user.email=o@x", "commit", "-q", "-m", "Remote"], { cwd: clone });
  await other.sync("push", "origin");
  await ws.sync("fetch", "origin");
  assert.equal((await ws.snapshot())!.head.behind, 1);
  await ws.sync("pull", "origin");
  assert.equal((await ws.read("repo", "remote.md")).content, "from clone");
  await assert.rejects(ws.sync("fetch", "--bad"), /configured remote/);
  await ws.removeRemote("origin");
  assert.deepEqual((await ws.snapshot())!.remotes, []);
});

test("a dedicated content branch keeps wiki and tasks off the code branches", async (t) => {
  const { ws, root, git } = await repo(t);
  const bare = root + "-content.git";
  t.after(() => fs.rm(bare, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => undefined));
  await exec("git", ["init", "-q", "--bare", "-b", "main", bare]);
  await ws.setRemote("origin", bare);
  await ws.setStorage("branch");
  let s = (await ws.snapshot())!;
  assert.deepEqual(s.storage, { mode: "branch", branch: "gitdesk", remote: null, ahead: 0, behind: 0 });
  assert.equal(s.wiki[0].path, "docs/Home.md");
  const task = await ws.createTask(input);
  const page = await ws.read("content", "docs/Home.md");
  await ws.write("content", page.path, "# Home\n\nShared.\n", page.hash);
  // The checkout is untouched; the content branch has one commit per edit.
  assert.deepEqual((await ws.snapshot())!.changes, []);
  await assert.rejects(fs.access(path.join(root, task.path)));
  const subjects = (await git("log", "--format=%s", "gitdesk")).stdout.trim().split("\n");
  assert.deepEqual(subjects.slice(0, 2), ["Edit docs/Home.md", "Create TP-1: Build it"]);
  await ws.syncContent();
  s = (await ws.snapshot())!;
  assert.equal(s.storage.mode === "branch" && s.storage.remote, "origin");
  // Another clone picks the content branch up from the remote automatically.
  const clone = root + "-clone";
  t.after(() => fs.rm(clone, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => undefined));
  await exec("git", ["clone", "-q", bare, clone]);
  const other = await Workspace.open({ kind: "local", path: clone });
  t.after(() => other.dispose());
  const theirs = (await other.snapshot())!;
  assert.equal(theirs.storage.mode, "branch");
  assert.deepEqual(theirs.tasks.map((x) => x.id), ["TP-1"]);
  const shared = (await other.read("content", "docs/Home.md")).content;
  assert.equal(shared.replace(/\r\n/g, "\n"), "# Home\n\nShared.\n");
  await ws.setStorage("worktree");
  assert.equal((await ws.snapshot())!.storage.mode, "worktree");
  const fsck = await exec("git", ["fsck", "--no-progress"], { cwd: root });
  assert.doesNotMatch(fsck.stdout + fsck.stderr, /missing/);
});

test("content-branch saves survive a failing auto-commit and commit later", async (t) => {
  const { ws, git } = await repo(t);
  await ws.setStorage("branch");
  await git("config", "user.useConfigOnly", "true");
  await git("config", "user.name", "");
  const page = await ws.read("content", "docs/Home.md");
  const saved = await ws.write("content", page.path, "# Home\n\nOffline edit.\n", page.hash);
  assert.equal(saved.content, "# Home\n\nOffline edit.\n");
  assert.match((await ws.snapshot())!.warnings.join("\n"), /not committed to the gitdesk branch/);
  await git("config", "user.name", "Test");
  const next = await ws.read("content", "docs/Architecture.md");
  await ws.write("content", next.path, "# Architecture\n\nOnline.\n", next.hash);
  const s = (await ws.snapshot())!;
  assert.doesNotMatch(s.warnings.join("\n"), /not committed/);
  const log = (await git("log", "--format=%s", "gitdesk")).stdout;
  assert.match(log, /Commit pending GitDesk edits/);
});

test("WSL repositories work through the shell transport", { skip: !(await wslDistros()).includes("Ubuntu") }, async (t) => {
  const { ShellHost, ShellSession } = await import("../core/shell-host.js");
  const host = new ShellHost(new ShellSession("wsl.exe", ["-d", "Ubuntu", "-e", "sh"], "WSL"));
  const dir = `/tmp/gitdesk-test-${process.pid}-${Date.now()}`;
  const sh = (script: string) => host.run("sh", ["-c", script], { cwd: "/" });
  await sh(
    `mkdir -p ${dir}/docs && cd ${dir} && git init -q -b main && git config user.name T && git config user.email t@x && ` +
      `printf '# Home\\n' > docs/Home.md && git add . && git commit -q -m init`,
  );
  t.after(async () => {
    await sh(`rm -rf ${dir}`);
    host.dispose();
  });
  const ws = await Workspace.open({ kind: "wsl", distro: "Ubuntu", path: dir }, host);
  const task = await ws.createTask({ ...input, status: "backlog", body: "Ünïcode 'quotes' %s\n" });
  const s = (await ws.snapshot())!;
  assert.equal(s.wiki[0].path, "docs/Home.md");
  assert.equal(s.tasks[0].body, "Ünïcode 'quotes' %s\n");
  await ws.stage([task.path]);
  await ws.commit("Add task", false);
  assert.equal((await ws.log(0, 5))[0].subject, "Add task");
  await assert.rejects(ws.read("repo", "missing.md"), /does not exist/);
});

test("renderer asset routes stay within the bundled UI", async () => {
  const { resolveAsset } = await import("../electron/assets.js");
  const root = path.resolve("dist");
  assert.equal(resolveAsset(root, "gitdesk://app/index.html"), path.join(root, "index.html"));
  assert.equal(resolveAsset(root, "gitdesk://app/assets/a.js"), path.join(root, "assets/a.js"));
  for (const url of [
    "gitdesk://other/index.html",
    "https://app/index.html",
    "gitdesk://app/%2e%2e%2fsecret",
    "gitdesk://app/%5csecret",
    "gitdesk://app/%00",
  ])
    assert.throws(() => resolveAsset(root, url));
});
