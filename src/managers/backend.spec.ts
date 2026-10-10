import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Managers } from "../contracts/manager-contracts";
import type { Location, Snapshot, TaskInput } from "../contracts/model";
import { connectManagers, dispatch } from "../contracts/rpc";
import { nodeMachine } from "../platforms/node/node-machine";
import { HostFactory } from "../access/hosts/host-factory";
import { createRemote, createRepository, onTestFinished } from "../testing/repository";
import { temporaryFolder } from "../testing/temp";
import { launchArgument } from "../utilities/launch-request";
import { createBackend } from "./backend";

const machine = nodeMachine();
const windows = machine.os === "windows";
const input: TaskInput = {
  title: "Build it",
  status: "backlog",
  priority: "high",
  assignee: "alice",
  labels: ["backend"],
  body: "Useful work.\n\n- [ ] Done\n",
  epic: "",
};

/** Managers behind the same serialising transport the shells use. */
async function backend(dataFolder?: string): Promise<Managers> {
  const managers = await createBackend(machine, dataFolder ?? (await temporaryFolder("data-")));
  onTestFinished(() => managers.dispose());
  return connectManagers((request) => dispatch(managers, structuredClone(request)));
}

async function opened(files?: Record<string, string>, commit?: boolean) {
  const repository = await createRepository(files, commit);
  const managers = await backend();
  const { id, snapshot } = await managers.workspace.open({ kind: "local", path: repository.root });
  const latest = async (): Promise<Snapshot> => (await managers.workspace.snapshot(id))!;
  return { repository, managers, id, snapshot, latest, ...managers };
}

describe("WorkspaceManager", () => {
  it("opens a repository with its wiki, files and settings", async () => {
    const { snapshot, repository } = await opened();
    expect(snapshot.settings.name).toBe("Test Project");
    expect(snapshot.wiki.map((node) => node.title)).toEqual(["Home", "Architecture"]);
    expect(snapshot.files.map((node) => node.name)).toEqual(["docs", "src", ".gitdesk.yml"]);
    expect(snapshot.head).toMatchObject({ branch: "main" });
    expect(snapshot.location).toEqual({ kind: "local", path: repository.root });
  });

  it("reports nothing new for an unchanged repository", async () => {
    const { workspace, id, snapshot, repository } = await opened();
    expect(await workspace.snapshot(id, snapshot.version)).toBeNull();
    await repository.write("new.txt", "x");
    expect(await workspace.snapshot(id, snapshot.version)).not.toBeNull();
  });

  it("explains folders it cannot open", async () => {
    const managers = await backend();
    await expect(managers.workspace.open({ kind: "local", path: await temporaryFolder("plain-", true) })).rejects.toThrow(
      "not inside a Git repository",
    );
    await expect(managers.workspace.open({ kind: "ssh", host: "-oProxyCommand=x", path: "/x" })).rejects.toThrow(
      "Invalid repository location.",
    );
  });

  it("closes the previous repository when another opens", async () => {
    const first = await opened();
    const second = await createRepository();
    await first.workspace.open({ kind: "local", path: second.root });
    await expect(first.workspace.snapshot(first.id)).rejects.toThrow("This repository is no longer open.");
    await expect(first.content.read("made-up", "repo", "a")).rejects.toThrow("no longer open");
  });

  it("remembers repositories and reopens the last one", async () => {
    const data = await temporaryFolder("data-");
    const repository = await createRepository();
    const location: Location = { kind: "local", path: repository.root };
    const first = await createBackend(machine, data);
    await first.workspace.open(location);
    expect((await first.workspace.recent()).map((entry) => entry.name)).toEqual(["Test Project"]);
    const restored = await first.workspace.restore([]);
    expect(restored?.snapshot.settings.name).toBe("Test Project");
    await first.dispose();

    const fresh = await createBackend(machine, data);
    const reopened = await fresh.workspace.restore([]);
    expect(reopened?.snapshot.location).toEqual(location);
    await fresh.workspace.setPreferences({ reopenLast: false });
    await fresh.dispose();
    expect(await (await backend(data)).workspace.restore([])).toBeNull();
  });

  it("opens the repository a launch asks for", async () => {
    const repository = await createRepository();
    const managers = await backend();
    const restored = await managers.workspace.restore(["app", launchArgument({ kind: "local", path: repository.root })]);
    expect(restored?.snapshot.settings.name).toBe("Test Project");
  });

  it("leaves the repository to the client when a launch carries a GitDesk link", async () => {
    const data = await temporaryFolder("data-");
    const first = await createBackend(machine, data);
    await first.workspace.open({ kind: "local", path: (await createRepository()).root });
    await first.dispose();
    const managers = await backend(data);
    expect(await managers.workspace.restore(["app", "gitdesk://open?remote=https://github.com/acme/demo.git&task=TP-1"])).toBeNull();
  });

  it("remembers the remotes of recent repositories as they change", async () => {
    const { workspace, versionControl, id, repository } = await opened();
    const remotes = async () => (await workspace.recent())[0]?.remotes;
    expect(await remotes()).toEqual([]);
    await versionControl.setRemote(id, "origin", "https://github.com/acme/demo.git");
    await workspace.snapshot(id);
    expect(await remotes()).toEqual(["https://github.com/acme/demo.git"]);
    await repository.git("remote", "add", "upstream", "git@github.com:other/demo.git");
    await workspace.open({ kind: "local", path: repository.root });
    expect(await remotes()).toEqual(["https://github.com/acme/demo.git", "git@github.com:other/demo.git"]);
  });

  it("forgets repositories", async () => {
    const { workspace, repository } = await opened();
    await workspace.forget({ kind: "local", path: repository.root });
    expect(await workspace.recent()).toEqual([]);
  });

  it("validates preferences", async () => {
    const managers = await backend();
    expect(await managers.workspace.setPreferences({ theme: "dark", autoSyncContent: true })).toEqual({
      theme: "dark",
      reopenLast: true,
      autoSyncContent: true,
    });
    await expect(managers.workspace.setPreferences({ theme: "neon" } as never)).rejects.toThrow("theme");
    await expect(managers.workspace.setPreferences({ reopenLast: "yes" } as never)).rejects.toThrow("reopenLast");
  });

  it("clones repositories next to each other and opens them", async () => {
    const source = await createRepository();
    const parent = await temporaryFolder("parent-");
    const managers = await backend();
    const { snapshot } = await managers.workspace.clone(source.root, { kind: "local", path: parent });
    expect(snapshot.settings.name).toBe("Test Project");
    await expect(managers.workspace.clone("--upload-pack=evil", { kind: "local", path: parent })).rejects.toThrow("Enter a Git URL");
    for (const helper of ["ext::calc.exe", " fd::3"])
      await expect(managers.workspace.clone(helper, { kind: "local", path: parent })).rejects.toThrow("remote helpers");
  });

  it("validates folders to browse", async () => {
    const managers = await backend();
    await expect(managers.workspace.browse({ kind: "local", path: "C:\\" } as never)).rejects.toThrow("folder dialog");
    await expect(managers.workspace.browse({ kind: "ssh", host: "-oProxyCommand=x", path: "" })).rejects.toThrow(
      "Invalid repository location.",
    );
    await expect(managers.workspace.browse({ kind: "wsl", distro: "Ubuntu", path: "relative" })).rejects.toThrow("absolute path");
  });

  it("explains SSH servers it cannot reach", async () => {
    const managers = await backend();
    await expect(managers.workspace.browse({ kind: "ssh", host: "nosuchhost.invalid", path: "" })).rejects.toThrow(
      /^Can't connect to nosuchhost\.invalid: \S/,
    );
  });

  it("explains why a repository could not be reopened", async () => {
    const data = await temporaryFolder("data-");
    const repository = await createRepository();
    const first = await createBackend(machine, data);
    await first.workspace.open({ kind: "local", path: repository.root });
    await first.dispose();
    const moved = `${repository.root}-moved`;
    await fs.rename(repository.root, moved);
    onTestFinished(() => fs.rm(moved, { recursive: true, force: true }));

    const managers = await backend(data);
    await expect(managers.workspace.restore([])).rejects.toThrow("does not exist");
    const requested = launchArgument({ kind: "local", path: repository.root });
    await expect(managers.workspace.restore(["app", requested])).rejects.toThrow("does not exist");
    await managers.workspace.setPreferences({ reopenLast: false });
    expect(await managers.workspace.restore([])).toBeNull();
  });
});

describe("ContentManager", () => {
  it("creates, moves and deletes pages with their subpages", async () => {
    const { content, id, latest } = await opened();
    expect((await content.createPage(id, "docs/Guides/Setup.md")).content).toBe("# Setup\n\n");
    await expect(content.createPage(id, "docs/Home.md")).rejects.toThrow("already exists");
    await expect(content.createPage(id, "src/x.md")).rejects.toThrow("inside docs/");
    expect(await content.movePage(id, "docs/Architecture.md", "docs/Design.md")).toBe("docs/Design.md");
    const design = (await latest()).wiki.find((node) => node.title === "Design")!;
    expect(design.children[0]!.path).toBe("docs/Design/Backend.md");
    await expect(content.deletePage(id, "docs/Design.md")).rejects.toThrow("subpages");
    await expect(content.movePage(id, "docs/Design.md", "docs/Design/Inner.md")).rejects.toThrow("below itself");
    await expect(content.movePage(id, "docs/Design.md", "docs/Home.md")).rejects.toThrow("already exists");
    await content.deletePage(id, "docs/Guides/Setup.md");
    await expect(content.read(id, "content", "docs/Guides/Setup.md")).rejects.toThrow("does not exist");
  });

  it("writes and removes repository files, rejecting stale edits", async () => {
    const { content, id } = await opened();
    const file = await content.read(id, "repo", "src/code.ts");
    const saved = await content.write(id, "repo", "src/code.ts", "export const value = 2;\n", file.hash);
    expect(saved).toMatchObject({ scope: "repo", path: "src/code.ts" });
    await expect(content.write(id, "repo", "src/code.ts", "stale", file.hash)).rejects.toThrow("changed on disk");
    await content.write(id, "repo", "notes/new.txt", "", null);
    await content.remove(id, "repo", "notes/new.txt");
    await expect(content.remove(id, "repo", "src")).rejects.toThrow("not a regular file");
  });

  it.each([
    "../x",
    "docs/../../x",
    ".git/config",
    ".git./config",
    "/etc/passwd",
    "docs\\Home.md",
    "",
    ...(windows ? ["GIT~1/config", "code.ts:stream", "docs/Home.md.", "con"] : []),
  ])("refuses the path %j", async (path) => {
    const { content, id } = await opened();
    await expect(content.write(id, "repo", path, "bad", null)).rejects.toThrow();
  });

  it.skipIf(!windows)("never lets settings reach .git through Windows aliases", async () => {
    const { content, id, latest, repository } = await opened({
      ".gitdesk.yml": "name: T\ntaskPrefix: TP\ntaskRoot: GIT~1/info\n",
      "docs/Home.md": "# Home\n",
    });
    const snapshot = await latest();
    expect(snapshot.settings.taskRoot).toBe("tasks");
    expect(snapshot.warnings.join("\n")).toMatch(/GIT~1\/info is not a valid path/);
    // Defaults apply, so the task lands in tasks/ with the folder's prefix.
    expect((await content.createTask(id, input)).path).toMatch(/^tasks\/[A-Z][A-Z0-9]*-1\.md$/);
    expect((await fs.readdir(path.join(repository.root, ".git", "info"))).some((name) => name.endsWith(".md"))).toBe(false);
    await expect(content.saveSettings(id, { ...snapshot.settings, taskRoot: "GIT~1/info" }, snapshot.settingsHash)).rejects.toThrow(
      "not a valid path",
    );
  });

  it("renames a page and its subpages by case only", async () => {
    const { content, id, repository } = await opened();
    expect(await content.movePage(id, "docs/Architecture.md", "docs/architecture.md")).toBe("docs/architecture.md");
    const names = await fs.readdir(path.join(repository.root, "docs"));
    expect(names).toEqual(expect.arrayContaining(["architecture.md", "architecture"]));
    expect(names).not.toContain("Architecture.md");
    expect(await repository.read("docs/architecture/Backend.md")).toBe("# Backend\n");
  });

  it("serves images as data URLs and refuses other files", async () => {
    const { content, id, repository } = await opened();
    await repository.write("docs/pixel.png", new Uint8Array([137, 80, 78, 71]));
    expect(await content.image(id, "content", "docs/pixel.png")).toBe("data:image/png;base64,iVBORw==");
    await expect(content.image(id, "repo", "src/code.ts")).rejects.toThrow("not a supported image");
  });

  it("creates tasks with sequential IDs and updates them in place", async () => {
    const { content, id, latest, repository } = await opened();
    const first = await content.createTask(id, input);
    const second = await content.createTask(id, { ...input, title: "Second" });
    expect([first.id, second.id, first.path]).toEqual(["TP-1", "TP-2", "tasks/TP-1.md"]);
    const raw = await content.read(id, "content", first.path);
    await content.write(id, "content", first.path, raw.content.replace("title:", "# keep me\nestimate: 3\ntitle:"), raw.hash);
    const current = (await latest()).tasks.find((task) => task.id === "TP-1")!;
    const updated = await content.updateTask(id, first.path, { ...input, status: "done", labels: [] }, current.hash);
    expect(updated).toMatchObject({ status: "done", labels: [] });
    const text = await repository.read(first.path);
    expect(text).toMatch(/# keep me/);
    expect(text).toMatch(/estimate: 3/);
    await expect(content.updateTask(id, first.path, input, current.hash)).rejects.toThrow("changed on disk");
    await content.deleteTask(id, second.path);
    expect((await latest()).tasks.map((task) => task.id)).toEqual(["TP-1"]);
    await expect(content.createTask(id, { ...input, status: "nope" })).rejects.toThrow("workflow states");
    await expect(content.updateTask(id, "docs/Home.md", input, "x")).rejects.toThrow("inside tasks/");
  });

  it("keeps tasks of an epic in its folder and moves them between epics", async () => {
    const { content, id, latest, repository } = await opened();
    const first = await content.createTask(id, { ...input, epic: "Login rework" });
    const second = await content.createTask(id, { ...input, title: "Second" });
    // IDs are unique across epics.
    expect([first.path, first.epic, second.id]).toEqual(["tasks/Login rework/TP-1.md", "Login rework", "TP-2"]);
    const moved = await content.updateTask(id, first.path, { ...input, epic: "Billing/Invoices", status: "done" }, first.hash);
    expect(moved).toMatchObject({ id: "TP-1", path: "tasks/Billing/Invoices/TP-1.md", epic: "Billing/Invoices", status: "done" });
    expect(await repository.exists("tasks/Login rework/TP-1.md")).toBe(false);
    const back = await content.updateTask(id, moved.path, { ...input, epic: "" }, moved.hash);
    expect(back.path).toBe("tasks/TP-1.md");
    expect((await latest()).tasks.map((task) => [task.id, task.epic])).toEqual(
      expect.arrayContaining([
        ["TP-1", ""],
        ["TP-2", ""],
      ]),
    );
    // Another task already has the ID's file name in the target epic.
    await repository.write("tasks/Billing/TP-2.md", "not a task");
    await expect(content.updateTask(id, second.path, { ...input, epic: "Billing" }, second.hash)).rejects.toThrow("already exists");
    await expect(content.createTask(id, { ...input, epic: "../outside" })).rejects.toThrow("epic");
  });

  it("files tasks under an epic's existing spelling", async () => {
    const { content, id } = await opened();
    const first = await content.createTask(id, { ...input, epic: "Auth" });
    const second = await content.createTask(id, { ...input, title: "Second", epic: "auth" });
    expect(second).toMatchObject({ path: "tasks/Auth/TP-2.md", epic: "Auth" });
    const updated = await content.updateTask(id, first.path, { ...input, epic: "AUTH", status: "done" }, first.hash);
    expect(updated).toMatchObject({ path: "tasks/Auth/TP-1.md", epic: "Auth", status: "done" });
  });

  it("skips task IDs whose files exist in any epic", async () => {
    const { content, id } = await opened({ ".gitdesk.yml": "name: T\ntaskPrefix: TP\n", "tasks/Old/TP-1.md": "not a task" });
    expect((await content.createTask(id, input)).id).toBe("TP-2");
  });

  it("skips task IDs whose files exist without a task", async () => {
    const { content, id } = await opened({ ...{ ".gitdesk.yml": "name: T\ntaskPrefix: TP\n" }, "tasks/TP-1.md": "not a task" });
    expect((await content.createTask(id, input)).id).toBe("TP-2");
  });

  it("turns broken tasks, duplicate IDs and broken settings into warnings", async () => {
    const task = "---\nid: X-1\ntitle: T\nstatus: todo\n---\n";
    const { content, id, latest, repository } = await opened({
      "tasks/bad.md": "---\nid: [broken\n---\n",
      "tasks/a.md": task,
      "tasks/b.md": task,
    });
    let snapshot = await latest();
    expect(snapshot.tasks).toHaveLength(2);
    expect(snapshot.warnings.join("\n")).toMatch(/bad\.md: Invalid YAML/);
    expect(snapshot.warnings.join("\n")).toMatch(/X-1 is also used by tasks\/a\.md/);
    await repository.write(".gitdesk.yml", "name: [broken\nextra: 1\n");
    await content.write(id, "repo", "touch.txt", "", null);
    snapshot = await latest();
    expect(snapshot.settings.wikiRoot).toBe("docs");
    expect(snapshot.warnings[0]).toMatch(/\.gitdesk\.yml/);
    await content.saveSettings(id, { ...snapshot.settings, name: "Fixed" }, snapshot.settingsHash);
    expect((await latest()).settings.name).toBe("Fixed");
  });

  it("saves settings over the file, keeping unknown keys, and rejects stale or invalid saves", async () => {
    const { content, id, latest, repository } = await opened({
      ".gitdesk.yml": "# comment\nname: A\ncustom: true\n",
      "docs/Home.md": "# Home\n",
    });
    const snapshot = await latest();
    await content.saveSettings(id, { ...snapshot.settings, name: "B", statuses: ["open", "closed"] }, snapshot.settingsHash);
    expect(await repository.read(".gitdesk.yml")).toMatch(/# comment[\s\S]*custom: true/);
    await expect(content.saveSettings(id, snapshot.settings, snapshot.settingsHash)).rejects.toThrow("changed on disk");
    const next = await latest();
    expect(next.settings).toMatchObject({ name: "B", statuses: ["open", "closed"] });
    await expect(content.saveSettings(id, { ...next.settings, wikiRoot: "tasks" }, next.settingsHash)).rejects.toThrow(
      "contain each other",
    );
  });

  it("keeps wiki and tasks on a dedicated branch when asked", async () => {
    const { content, id, latest, repository } = await opened();
    await content.setStorage(id, "branch");
    expect((await latest()).storage).toEqual({ mode: "branch", branch: "gitdesk", remote: null, ahead: 0, behind: 0 });
    const task = await content.createTask(id, input);
    const page = await content.read(id, "content", "docs/Home.md");
    await content.write(id, "content", page.path, "# Home\n\nShared.\n", page.hash);
    const snapshot = await latest();
    expect(snapshot.changes).toEqual([]);
    expect(snapshot.tasks.map((t) => t.id)).toEqual(["TP-1"]);
    expect(await repository.exists(task.path)).toBe(false);
    expect((await repository.git("log", "--format=%s", "gitdesk")).split("\n").slice(0, 2)).toEqual([
      "Edit docs/Home.md",
      "Create TP-1: Build it",
    ]);
    await expect(content.setStorage(id, "cloud" as never)).rejects.toThrow("Invalid storage mode.");
    await content.setStorage(id, "worktree");
    expect((await latest()).storage.mode).toBe("worktree");
  });

  it("syncs the content branch with the remote", async () => {
    const { content, versionControl, id, latest } = await opened();
    await versionControl.setRemote(id, "origin", await createRemote());
    await content.setStorage(id, "branch");
    await content.syncContent(id);
    expect((await latest()).storage).toMatchObject({ remote: "origin" });
  });

  it("warns when content edits could not be committed", async () => {
    const { content, id, latest, repository } = await opened();
    await content.setStorage(id, "branch");
    await repository.git("config", "user.useConfigOnly", "true");
    await repository.git("config", "user.name", "");
    const page = await content.read(id, "content", "docs/Home.md");
    await content.write(id, "content", page.path, "# Offline\n", page.hash);
    expect((await latest()).warnings.join("\n")).toMatch(/not committed to the gitdesk branch/);
  });
});

describe("ContentManager: agent files", () => {
  const ALL = ["claudeSkill", "agentsSkill", "agents", "claude", "copilot"] as const;
  const states = async (content: Managers["content"], id: string, targets: readonly (typeof ALL)[number][] = ALL) =>
    Object.fromEntries((await content.agentFiles(id, targets)).map((file) => [file.path, file.state]));

  it("adds the skill and instruction files to the checkout for the project's settings", async () => {
    const { content, id, repository, latest } = await opened();
    expect(Object.values(await states(content, id))).toEqual(["missing", "missing", "missing", "missing", "missing"]);
    const written = await content.addAgentFiles(id, ["claudeSkill", "agentsSkill", "agents", "claude"]);
    expect(written).toEqual([
      { path: ".claude/skills/gitdesk/SKILL.md", result: "created" },
      { path: ".agents/skills/gitdesk/SKILL.md", result: "created" },
      { path: "AGENTS.md", result: "created" },
      { path: "CLAUDE.md", result: "created" },
    ]);
    expect(await repository.read(".agents/skills/gitdesk/SKILL.md")).toContain("`tasks/TP-12.md`");
    expect(await repository.read("CLAUDE.md")).toContain("@AGENTS.md");
    expect(await repository.exists(".github/copilot-instructions.md")).toBe(false);
    expect((await latest()).changes.map((change) => change.path)).toEqual(
      expect.arrayContaining([".claude/skills/gitdesk/SKILL.md", "AGENTS.md", "CLAUDE.md"]),
    );
    expect(await states(content, id, ["claudeSkill", "agentsSkill", "agents", "claude"])).toEqual({
      ".claude/skills/gitdesk/SKILL.md": "current",
      ".agents/skills/gitdesk/SKILL.md": "current",
      "AGENTS.md": "current",
      "CLAUDE.md": "current",
      ".github/copilot-instructions.md": "missing",
    });
  });

  it("merges its block into existing instruction files and changes nothing the second time", async () => {
    const crlf = String.fromCharCode(13, 10);
    const { content, id, repository } = await opened();
    await repository.write("AGENTS.md", `# Agents${crlf}${crlf}Run the tests.${crlf}`);
    await content.addAgentFiles(id, ["agents"]);
    const agents = await repository.read("AGENTS.md");
    expect(agents.startsWith(`# Agents${crlf}${crlf}Run the tests.${crlf}${crlf}<!-- gitdesk:begin -->${crlf}`)).toBe(true);
    expect(agents).not.toMatch(/[^\r]\n/);
    expect(await content.addAgentFiles(id, ["agents"])).toEqual([{ path: "AGENTS.md", result: "unchanged" }]);
    expect(await repository.read("AGENTS.md")).toBe(agents);
  });

  it("updates the files after the settings changed", async () => {
    const { content, id, repository, latest } = await opened();
    await content.addAgentFiles(id, ["agentsSkill", "agents"]);
    const snapshot = await latest();
    await content.saveSettings(id, { ...snapshot.settings, taskPrefix: "NEW" }, snapshot.settingsHash);
    expect(await states(content, id, ["agentsSkill", "agents"])).toMatchObject({
      ".agents/skills/gitdesk/SKILL.md": "outdated",
      "AGENTS.md": "outdated",
    });
    expect(await content.addAgentFiles(id, ["agentsSkill", "agents"])).toEqual([
      { path: ".agents/skills/gitdesk/SKILL.md", result: "updated" },
      { path: "AGENTS.md", result: "updated" },
    ]);
    expect(await repository.read("AGENTS.md")).toContain("`NEW-12.md`");
  });

  it("writes to the checkout while wiki and tasks live on the content branch", async () => {
    const { content, id, repository } = await opened();
    await content.setStorage(id, "branch");
    await content.addAgentFiles(id, ["agents"]);
    expect(await repository.read("AGENTS.md")).toContain("`tasks/`");
    expect(await repository.git("log", "--format=%s", "-1", "gitdesk")).not.toContain("AGENTS");
  });

  it("writes nothing when one file has broken markers, and warns about ignored files", async () => {
    const { content, id, repository } = await opened();
    await repository.write(".gitignore", ".claude/\n");
    const ignored = (await content.agentFiles(id, ALL)).filter((file) => file.ignored).map((file) => file.path);
    expect(ignored).toEqual([".claude/skills/gitdesk/SKILL.md"]);
    await repository.write("CLAUDE.md", "<!-- gitdesk:begin -->\nUnfinished.\n");
    await expect(content.agentFiles(id, ALL)).rejects.toThrow("CLAUDE.md has unmatched GitDesk markers");
    await expect(content.addAgentFiles(id, ["agents", "claude"])).rejects.toThrow("CLAUDE.md has unmatched GitDesk markers");
    expect(await repository.exists("AGENTS.md")).toBe(false);
  });

  it("validates the targets", async () => {
    const { content, id } = await opened();
    await expect(content.agentFiles(id, ["cursor"] as never)).rejects.toThrow("Unknown agent file");
    await expect(content.addAgentFiles(id, "agents" as never)).rejects.toThrow("Unknown agent file");
    await expect(content.addAgentFiles(id, [])).rejects.toThrow("Choose the files to add.");
  });
});

describe("VersionControlManager", () => {
  it("stages, commits and diffs through the contract", async () => {
    const { versionControl, content, id, latest } = await opened();
    const file = await content.read(id, "repo", "src/code.ts");
    await content.write(id, "repo", file.path, "export const value = 2;\n", file.hash);
    expect(await versionControl.diff(id, "src/code.ts", "worktree")).toMatchObject({
      binary: false,
      original: "export const value = 1;\n",
      modified: "export const value = 2;\n",
    });
    await versionControl.stage(id, ["src/code.ts"]);
    await versionControl.commit(id, "  Change value  ", false);
    expect(await versionControl.lastCommitMessage(id)).toBe("Change value");
    const [latestCommit] = await versionControl.log(id, 0, 1);
    expect((await versionControl.commitDetail(id, latestCommit!.hash)).files).toEqual([{ status: "M", path: "src/code.ts" }]);
    expect((await latest()).changes).toEqual([]);
  });

  it("marks binary diffs", async () => {
    const { versionControl, id, repository } = await opened();
    await repository.write("bin.dat", new Uint8Array([0, 1, 2]));
    expect(await versionControl.diff(id, "bin.dat", "worktree")).toEqual({ path: "bin.dat", binary: true, original: "", modified: "" });
  });

  it("does not compare files too large to show", async () => {
    const { versionControl, id, repository } = await opened();
    await repository.write("src/code.ts", "x".repeat(3 * 1024 * 1024));
    expect(await versionControl.diff(id, "src/code.ts", "worktree")).toEqual({
      path: "src/code.ts",
      binary: true,
      original: "",
      modified: "",
    });
  });

  it.each([
    ["diff source", (m: Managers, id: string) => m.versionControl.diff(id, "a", { commit: "HEAD" }), "Invalid diff source."],
    ["commit ID", (m: Managers, id: string) => m.versionControl.commitDetail(id, "HEAD~1"), "Invalid commit ID."],
    ["history range", (m: Managers, id: string) => m.versionControl.log(id, -1, 10), "Invalid history range."],
    ["empty message", (m: Managers, id: string) => m.versionControl.commit(id, "  ", false), "Write a commit message first."],
    ["empty selection", (m: Managers, id: string) => m.versionControl.stage(id, []), "Select files first."],
    ["branch option", (m: Managers, id: string) => m.versionControl.createBranch(id, "--force"), "Invalid branch name."],
    ["branch name", (m: Managers, id: string) => m.versionControl.createBranch(id, "bad..name"), "not a valid branch name"],
    ["remote", (m: Managers, id: string) => m.versionControl.sync(id, "fetch", "--upload-pack=x"), "Choose a configured remote."],
    ["action", (m: Managers, id: string) => m.versionControl.sync(id, "merge" as never, "origin"), "Invalid action."],
    ["remote name", (m: Managers, id: string) => m.versionControl.setRemote(id, "-x", "u"), "Remote names"],
    ["remote URL", (m: Managers, id: string) => m.versionControl.setRemote(id, "origin", "-u"), "valid remote URL"],
  ])("rejects an invalid %s", async (_, call, message) => {
    const { managers, id } = await opened();
    await expect(call(managers, id)).rejects.toThrow(message);
  });

  it("creates and switches branches", async () => {
    const { versionControl, id, latest } = await opened();
    await versionControl.createBranch(id, "feature/x");
    expect((await latest()).head.branch).toBe("feature/x");
    await versionControl.switchBranch(id, "main");
    expect((await latest()).branches).toEqual(["feature/x", "main"]);
  });
});

/** WSL end to end, through the shell transport, when the Ubuntu distribution exists. */
describe("WSL repositories", async () => {
  const ubuntu = (await new HostFactory(machine).distributions()).includes("Ubuntu");
  it.skipIf(!ubuntu)("open, edit and commit through the shell transport", async () => {
    const managers = await createBackend(machine, await temporaryFolder("data-"));
    const dir = `/tmp/gitdesk-test-${Date.now()}`;
    const run = async (script: string) => {
      const { execFile } = await import("node:child_process");
      await new Promise((resolve, reject) =>
        execFile("wsl.exe", ["-d", "Ubuntu", "-e", "sh", "-c", script], (e) => (e ? reject(e) : resolve(null))),
      );
    };
    await run(
      `mkdir -p ${dir}/docs && cd ${dir} && git init -q -b main && git config user.name T && git config user.email t@x && printf '# Home\\n' > docs/Home.md && git add . && git commit -q -m init`,
    );
    onTestFinished(async () => {
      await run(`rm -rf ${dir}`);
      await managers.dispose();
    });
    const { id, snapshot } = await managers.workspace.open({ kind: "wsl", distro: "Ubuntu", path: dir });
    expect(snapshot.wiki[0]!.path).toBe("docs/Home.md");
    const task = await managers.content.createTask(id, { ...input, body: "Ünïcode 'quotes' %s\n" });
    expect((await managers.workspace.snapshot(id))!.tasks[0]!.body).toBe("Ünïcode 'quotes' %s\n");
    await managers.versionControl.stage(id, [task.path]);
    await managers.versionControl.commit(id, "Add task", false);
    expect((await managers.versionControl.log(id, 0, 5))[0]!.subject).toBe("Add task");
    await expect(managers.content.read(id, "repo", "missing.md")).rejects.toThrow("does not exist");
  });

  it.skipIf(!ubuntu)("browse folders and name missing distributions", async () => {
    const managers = await backend();
    const root = await managers.workspace.browse({ kind: "wsl", distro: "Ubuntu", path: "/" });
    expect(root).toMatchObject({ path: "/", parent: null, truncated: false });
    expect(root.folders).toContainEqual({ name: "tmp", repository: false });
    await expect(managers.workspace.browse({ kind: "wsl", distro: "GitDeskNoSuchDistro", path: "" })).rejects.toThrow(
      "WSL has no distribution named GitDeskNoSuchDistro.",
    );
  });
});
