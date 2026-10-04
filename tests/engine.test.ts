import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { RepositoryEngine, parseStatus } from "../electron/engine.js";
const exec = promisify(execFile);
async function fixture(t: any, committed = true) {
  const base = path.resolve(".test-work");
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, "repo-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const git = (...args: string[]) => exec("git", args, { cwd: root });
  await git("init", "-b", "main");
  await git("config", "user.name", "Test");
  await git("config", "user.email", "test@example.com");
  await fs.mkdir(path.join(root, "docs/Architecture/Backend"), {
    recursive: true,
  });
  await fs.mkdir(path.join(root, "tasks"));
  for (const [p, s] of Object.entries({
    "docs/Home.md": "# Home\n",
    "docs/Architecture.md": "# Architecture\n",
    "docs/Architecture/Backend.md": "# Backend\n",
    "docs/Architecture/Backend/Auth.md": "# Auth\n",
    "code.ts": "export const value = 1;\n",
  }))
    await fs.writeFile(path.join(root, p), s);
  if (committed) {
    await git("add", ".");
    await git("commit", "-m", "Initial commit");
  }
  return { root, git, engine: await RepositoryEngine.open(root) };
}
const input = {
  title: "Build it",
  status: "backlog",
  priority: "high",
  assignee: "Alice",
  labels: ["backend"],
  body: "## Description\nUseful work.\n",
};
test("wiki pairs sibling page and directory, nested and orphan directories", async (t) => {
  const { engine, root } = await fixture(t);
  await fs.mkdir(path.join(root, "docs/Orphan"));
  await fs.writeFile(path.join(root, "docs/Orphan/Leaf.md"), "# Leaf");
  const s = await engine.snapshot();
  const architecture = s.wiki.find((n) => n.title === "Architecture")!;
  assert.equal(architecture.path, "docs/Architecture.md");
  assert.equal(architecture.children[0].path, "docs/Architecture/Backend.md");
  assert.equal(architecture.children[0].children[0].title, "Auth");
  assert.equal(s.wiki.find((n) => n.title === "Orphan")!.path, null);
  assert.equal(s.commits[0].subject, "Initial commit");
});
test("tasks persist Markdown; unknown fields, comments, and task IDs survive updates", async (t) => {
  const { engine, root } = await fixture(t);
  const created = await engine.createTask(input);
  assert.match(created.id, /^[a-f0-9-]{36}$/);
  assert.equal(created.body, input.body);
  const raw = await engine.read(created.path);
  await engine.save(
    created.path,
    raw.content.replace("title:", "# Team comment\nestimate: 3\ntitle:"),
    raw.hash,
  );
  const updatedFile = await engine.read(created.path);
  const updated = await engine.updateTask(
    created.path,
    { ...input, status: "done", title: "Done" },
    updatedFile.hash,
  );
  assert.equal(updated.id, created.id);
  assert.equal(updated.status, "done");
  const content = await fs.readFile(path.join(root, created.path), "utf8");
  assert.match(content, /estimate: 3/);
  assert.match(content, /# Team comment/);
  assert.equal((await engine.snapshot()).tasks.length, 1);
});
test("stale file and stale task saves preserve external changes", async (t) => {
  const { engine, root } = await fixture(t);
  const f = await engine.read("code.ts");
  await fs.writeFile(path.join(root, "code.ts"), "external\n");
  await assert.rejects(engine.save(f.path, "stale", f.hash), /changed on disk/);
  assert.equal((await engine.read(f.path)).content, "external\n");
  const task = await engine.createTask(input);
  await engine.updateTask(task.path, { ...input, status: "review" }, task.hash);
  await assert.rejects(
    engine.updateTask(task.path, { ...input, status: "done" }, task.hash),
    /changed on disk/,
  );
});
test("path traversal, .git writes, symlinks and binary files are blocked", async (t) => {
  const { engine, root } = await fixture(t);
  for (const p of [
    "../outside",
    "docs/../../outside",
    ".git/config",
    "docs/../code.ts",
    "/etc/passwd",
    "docs\\Home.md",
  ])
    await assert.rejects(engine.save(p, "bad", null));
  await fs.symlink(path.join(root, "code.ts"), path.join(root, "link.ts"));
  await assert.rejects(engine.read("link.ts"), /Symbolic links/);
  await fs.writeFile(path.join(root, "binary"), Buffer.from([0, 1, 2]));
  await assert.rejects(engine.read("binary"), /Binary/);
});
test("malformed tasks produce warnings without breaking the board", async (t) => {
  const { engine, root } = await fixture(t);
  await fs.writeFile(
    path.join(root, "tasks/bad.md"),
    "---\nid: [broken\n---\ntext",
  );
  const s = await engine.snapshot();
  assert.equal(s.tasks.length, 0);
  assert.equal(s.warnings.length, 1);
  assert.match(s.warnings[0], /bad.md/);
});
test("settings are versioned, stale-protected and preserve extension fields", async (t) => {
  const { engine } = await fixture(t);
  let s = await engine.snapshot();
  await engine.saveSettings({ ...s.settings, name: "Custom" }, null);
  s = await engine.snapshot();
  assert.equal(s.settings.name, "Custom");
  const f = await engine.read(".gitdesk.yml");
  await engine.save(f.path, f.content + "extensions:\n  flag: true\n", f.hash);
  await assert.rejects(
    engine.saveSettings(s.settings, s.settingsHash),
    /changed on disk/,
  );
  const next = await engine.snapshot();
  await engine.saveSettings(
    { ...next.settings, name: "New" },
    next.settingsHash,
  );
  assert.match((await engine.read(".gitdesk.yml")).content, /flag: true/);
  await assert.rejects(
    engine.saveSettings({ ...next.settings, wikiRoot: "tasks" }, null),
    /separate/,
  );
});
test("staging, unstaging, committing, history and branch protection work", async (t) => {
  const { engine } = await fixture(t);
  const f = await engine.read("code.ts");
  await engine.save(f.path, "export const value = 2;\n", f.hash);
  let s = await engine.snapshot();
  assert.equal(s.changes[0].worktree, "M");
  assert.match((await engine.diff(f.path, false)).original, /1/);
  assert.match((await engine.diff(f.path, false)).modified, /2/);
  await assert.rejects(engine.createBranch("feature/work"), /working tree/);
  await engine.stage(f.path);
  s = await engine.snapshot();
  assert.equal(s.changes[0].index, "M");
  assert.match((await engine.diff(f.path, true)).modified, /2/);
  await engine.unstage(f.path);
  assert.equal((await engine.snapshot()).changes[0].index, " ");
  await engine.stage(f.path);
  await engine.commit("Change value");
  await engine.createBranch("feature/work");
  assert.equal((await engine.snapshot()).branch, "feature/work");
  await engine.switchBranch("main");
  s = await engine.snapshot();
  assert.equal(s.changes.length, 0);
  assert.equal(s.commits[0].subject, "Change value");
  assert.deepEqual(await engine.commitFiles(s.commits[0].hash), ["code.ts"]);
  assert.match(
    (await engine.diff("code.ts", false, s.commits[0].hash)).original,
    /1/,
  );
});
test("renamed paths with spaces are parsed and unstage restores the complete rename", async (t) => {
  const { engine, git } = await fixture(t);
  await git("mv", "code.ts", "new code.ts");
  const s = await engine.snapshot();
  assert.equal(s.changes[0].path, "new code.ts");
  assert.equal(s.changes[0].oldPath, "code.ts");
  await engine.unstage("new code.ts");
  assert.equal(
    (await engine.snapshot()).changes.every(
      (c) => c.index === " " || c.index === "?",
    ),
    true,
  );
  assert.deepEqual(parseStatus("R  new\0old\0?? extra\0"), [
    { path: "new", oldPath: "old", index: "R", worktree: " " },
    { path: "extra", index: "?", worktree: "?" },
  ]);
});
test("unborn repositories can stage and unstage a first file", async (t) => {
  const { engine } = await fixture(t, false);
  await engine.stage("code.ts");
  await engine.unstage("code.ts");
  const s = await engine.snapshot();
  assert.equal(s.commits.length, 0);
  assert.equal(s.changes.find((c) => c.path === "code.ts")!.index, "?");
});
test("exclusive queue continues after a failed operation", async (t) => {
  const { engine } = await fixture(t);
  const order: string[] = [];
  const failed = engine.exclusive(async () => {
    order.push("first");
    throw new Error("Expected");
  });
  const second = engine.exclusive(async () => {
    order.push("second");
    return 42;
  });
  await assert.rejects(failed);
  assert.equal(await second, 42);
  assert.deepEqual(order, ["first", "second"]);
});
test("generic remotes fetch, push and fast-forward pull from local repositories", async (t) => {
  const { engine, root, git } = await fixture(t);
  const bare = root + "-remote.git";
  t.after(() => fs.rm(bare, { recursive: true, force: true }));
  await exec("git", ["init", "--bare", "--initial-branch=main", bare]);
  await engine.setRemote("origin", bare);
  await engine.sync("push", "origin");
  await engine.sync("fetch", "origin");
  assert.equal((await engine.snapshot()).remotes[0].url, bare);
  const clone = root + "-clone";
  t.after(() => fs.rm(clone, { recursive: true, force: true }));
  await exec("git", ["clone", bare, clone]);
  const cgit = (...args: string[]) => exec("git", args, { cwd: clone });
  await cgit("config", "user.name", "Other");
  await cgit("config", "user.email", "other@example.com");
  await fs.writeFile(path.join(clone, "remote.md"), "remote change");
  await cgit("add", ".");
  await cgit("commit", "-m", "Remote change");
  await cgit("push");
  await engine.sync("pull", "origin");
  assert.equal((await engine.read("remote.md")).content, "remote change");
  await assert.rejects(engine.sync("fetch", "--bad"), /configured remote/);
});

// A standard, secure app scheme lets Monaco module workers load from a real origin.
test("renderer asset routes stay within the bundled UI", async () => {
  const { resolveAsset } = await import("../electron/assets.js");
  const root = path.resolve("dist");
  assert.equal(
    resolveAsset(root, "gitdesk://app/index.html"),
    path.join(root, "index.html"),
  );
  assert.equal(
    resolveAsset(root, "gitdesk://app/assets/editor.worker.js"),
    path.join(root, "assets/editor.worker.js"),
  );
  for (const url of [
    "gitdesk://other/index.html",
    "https://app/index.html",
    "gitdesk://app/%2e%2e%2fsecret",
    "gitdesk://app/%5csecret",
    "gitdesk://app/%00",
  ])
    assert.throws(() => resolveAsset(root, url));
});
