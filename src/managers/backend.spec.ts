import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Managers } from "../contracts/manager-contracts";
import type { Location, Snapshot, TaskInput } from "../contracts/model";
import { connectManagers, dispatch } from "../contracts/rpc";
import { nodeMachine } from "../platforms/node/node-machine";
import { HostFactory } from "../access/hosts/host-factory";
import { cloneRepository, createRemote, createRepository, DEFAULT_FILES, onTestFinished } from "../testing/repository";
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

async function shareEverything(content: Managers["content"], id: string) {
  for (const area of ["wiki", "tasks", "settings"] as const) await content.setStorage(id, area, "branch");
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
    expect(await managers.workspace.setPreferences({ theme: "dark", autoSyncContent: true, minimap: false })).toEqual({
      theme: "dark",
      reopenLast: true,
      autoSyncContent: true,
      minimap: false,
      lastSeenVersion: null,
      tourSeen: false,
      tourOffered: [],
    });
    await expect(managers.workspace.setPreferences({ theme: "neon" } as never)).rejects.toThrow("theme");
    await expect(managers.workspace.setPreferences({ reopenLast: "yes" } as never)).rejects.toThrow("reopenLast");
    await expect(managers.workspace.setPreferences({ tourSeen: 1 } as never)).rejects.toThrow("tourSeen");
    await expect(managers.workspace.setPreferences({ minimap: 1 } as never)).rejects.toThrow("minimap");
    await expect(managers.workspace.setPreferences({ lastSeenVersion: "latest" })).rejects.toThrow("lastSeenVersion");
    await expect(managers.workspace.setPreferences({ tourOffered: ["local:/a", 3] } as never)).rejects.toThrow("tourOffered");
    await expect(managers.workspace.setPreferences({ tourOffered: "local:/a" } as never)).rejects.toThrow("tourOffered");
  });

  it("keeps what the user has seen of the onboarding across restarts", async () => {
    const data = await temporaryFolder("data-");
    const first = await createBackend(machine, data);
    const offered = Array.from({ length: 120 }, (_, i) => `local:/r${i}`);
    await first.workspace.setPreferences({ lastSeenVersion: "0.3.2", tourSeen: true, tourOffered: offered });
    await first.dispose();
    const second = await backend(data);
    expect(await second.workspace.preferences()).toMatchObject({
      lastSeenVersion: "0.3.2",
      tourSeen: true,
      // Only the repositories offered last are remembered.
      tourOffered: offered.slice(-100),
    });
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

  it("creates a sample repository with history and a change to commit, and opens it", async () => {
    const parent = await temporaryFolder("parent-");
    const managers = await backend();
    const { id, snapshot } = await managers.workspace.createSample({ kind: "local", path: parent });
    expect(snapshot.location).toEqual({ kind: "local", path: path.join(parent, "gitdesk-sample") });
    expect(snapshot).toMatchObject({ settings: { name: "Pocket Weather" }, head: { branch: "main" }, warnings: [] });
    expect(snapshot.tasks).toHaveLength(6);
    expect(snapshot.changes).toEqual([{ path: "src/forecast.ts", index: " ", worktree: "M" }]);
    const log = await managers.versionControl.log(id, 0, 10);
    expect(log.map((commit) => [commit.subject, commit.author])).toEqual([
      ["Plan the first release", "GitDesk"],
      ["Write the wiki", "GitDesk"],
      ["Start Pocket Weather", "GitDesk"],
    ]);
    expect((await managers.workspace.recent())[0]!.name).toBe("Pocket Weather");

    // A second sample goes next to the first.
    const second = await managers.workspace.createSample({ kind: "local", path: parent });
    expect(second.snapshot.location).toEqual({ kind: "local", path: path.join(parent, "gitdesk-sample-2") });
    await expect(managers.workspace.createSample({ kind: "ssh", host: "-oProxyCommand=x", path: "/x" })).rejects.toThrow(
      "Invalid repository location.",
    );
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

  it("leaves no empty folders behind where pages moved out or were deleted", async () => {
    const { content, id, repository } = await opened();
    await content.createPage(id, "docs/Design/Notes/Ideas.md");
    await content.createPage(id, "docs/Old/Page.md");
    await content.movePage(id, "docs/Design/Notes/Ideas.md", "docs/Ideas.md");
    expect(await repository.exists("docs/Design")).toBe(false);
    await content.deletePage(id, "docs/Old/Page.md");
    expect(await repository.exists("docs/Old")).toBe(false);
    // A page moves with its subpages; the folder they left goes, the wiki folder stays.
    await content.movePage(id, "docs/Architecture/Backend.md", "docs/Backend.md");
    expect(await repository.exists("docs/Backend/Auth.md")).toBe(true);
    expect(await repository.exists("docs/Architecture")).toBe(false);
    expect(await repository.exists("docs/Architecture.md")).toBe(true);
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

  const LINKED: Record<string, string> = {
    ...DEFAULT_FILES,
    "docs/Home.md":
      "# Home\n\nSee [the backend](Architecture/Backend.md#auth) and [[Architecture]].\n\n```\n[[Architecture/Backend]]\n```\n",
    "docs/Architecture/Backend.md": "# Backend\n\nUp to [Home](../Home.md), down to [[Architecture/Backend/Auth]].\n",
    "tasks/TP-1.md": "---\nid: TP-1\ntitle: Document\nstatus: backlog\n---\nRead [[Architecture/Backend]].\n",
    "docs/Notes.md": "# Notes\n",
    "README.md": "Docs start at [Home](docs/Home.md).\n",
  };

  it("previews and updates the links to a moved page", async () => {
    const { content, id, repository } = await opened(LINKED);
    expect(await content.pageLinks(id, "docs/Architecture.md", "docs/Design/System.md")).toEqual([
      {
        path: "docs/Architecture/Backend.md",
        changes: [
          { line: 3, before: "../Home.md", after: "../../Home.md" },
          { line: 3, before: "Architecture/Backend/Auth", after: "Design/System/Backend/Auth" },
        ],
      },
      {
        path: "docs/Home.md",
        changes: [
          { line: 3, before: "Architecture/Backend.md", after: "Design/System/Backend.md" },
          { line: 3, before: "Architecture", after: "System" },
        ],
      },
      { path: "tasks/TP-1.md", changes: [{ line: 6, before: "Architecture/Backend", after: "Design/System/Backend" }] },
    ]);
    expect(await content.pageLinks(id, "docs/Notes.md", "docs/Archive/Notes.md")).toEqual([]);

    await content.movePage(id, "docs/Architecture.md", "docs/Design/System.md", { updateLinks: true });
    expect(await repository.read("docs/Home.md")).toBe(
      "# Home\n\nSee [the backend](Design/System/Backend.md#auth) and [[System]].\n\n```\n[[Architecture/Backend]]\n```\n",
    );
    expect(await repository.read("docs/Design/System/Backend.md")).toBe(
      "# Backend\n\nUp to [Home](../../Home.md), down to [[Design/System/Backend/Auth]].\n",
    );
    expect(await repository.read("tasks/TP-1.md")).toContain("Read [[Design/System/Backend]].");
    expect(await repository.read("README.md")).toBe(LINKED["README.md"]);
  });

  it("moves nothing when a link update could not be written", async () => {
    // Just below the size limit, until its links grow longer.
    const links = "[a](Architecture.md)\n".repeat(400);
    const big = `# Big\n\n\`\`\`\n${"x".repeat(2 * 1024 * 1024 - links.length - 100)}\n\`\`\`\n\n${links}`;
    const { content, id, repository } = await opened({ ...LINKED, "docs/Big.md": big });
    const target = "docs/Architecture-and-everything-around-it.md";
    await expect(content.movePage(id, "docs/Architecture.md", target, { updateLinks: true })).rejects.toThrow("limited to 2 MiB");
    expect(await repository.exists("docs/Architecture.md")).toBe(true);
    expect(await repository.exists(target)).toBe(false);
    expect(await repository.read("docs/Home.md")).toBe(LINKED["docs/Home.md"]);
  });

  it("moves the page back when a link update fails after the move, committing nothing", async () => {
    const { content, id, latest, repository } = await opened(LINKED);
    await shareEverything(content, id);
    const worktree = path.join(repository.root, ".git", "gitdesk", "gitdesk");
    const commits = await repository.git("rev-parse", "gitdesk");
    // A file that cannot be written, as one another program holds open on Windows.
    const home = path.join(worktree, "docs", "Home.md");
    await fs.chmod(home, 0o444);
    onTestFinished(() => fs.chmod(home, 0o644));
    await expect(content.movePage(id, "docs/Architecture.md", "docs/Design.md", { updateLinks: true })).rejects.toThrow();
    expect(await repository.git("rev-parse", "gitdesk")).toBe(commits);
    expect(await repository.git("-C", worktree, "status", "--porcelain")).toBe("");
    expect((await latest()).warnings).toEqual([]);
  });

  it("leaves links alone unless asked, and validates the options", async () => {
    const { content, id, repository } = await opened(LINKED);
    await expect(content.movePage(id, "docs/Architecture.md", "docs/Design.md", "yes" as never)).rejects.toThrow("Invalid move options.");
    await expect(content.movePage(id, "docs/Architecture.md", "docs/Design.md", { updateLinks: 1 } as never)).rejects.toThrow(
      "Invalid move options.",
    );
    await expect(content.pageLinks(id, "docs/Architecture.md", "src/Design.md")).rejects.toThrow("inside docs/");
    await content.movePage(id, "docs/Architecture.md", "docs/Design.md");
    expect(await repository.read("docs/Home.md")).toBe(LINKED["docs/Home.md"]);
  });

  it("commits a move and its link updates as one commit on the content branch", async () => {
    const { content, id, latest, repository } = await opened(LINKED);
    await shareEverything(content, id);
    const commits = Number(await repository.git("rev-list", "--count", "gitdesk"));
    await content.movePage(id, "docs/Architecture.md", "docs/Design.md", { updateLinks: true });
    expect(Number(await repository.git("rev-list", "--count", "gitdesk"))).toBe(commits + 1);
    const changed = await repository.git("show", "--name-status", "--format=%B", "gitdesk");
    expect(changed).toMatch(
      /^Move page Architecture to docs\/Design\.md\n\nUpdate links in docs\/Design\/Backend\.md, docs\/Home\.md, tasks\/TP-1\.md\.\n/,
    );
    expect(changed).toMatch(/^M\tdocs\/Home\.md$/m);
    expect(changed).toMatch(/^M\ttasks\/TP-1\.md$/m);
    expect(changed).toMatch(/^R\d+\tdocs\/Architecture\/Backend\/Auth\.md\tdocs\/Design\/Backend\/Auth\.md$/m);
    expect(await repository.git("show", "gitdesk:docs/Home.md")).toContain("[the backend](Design/Backend.md#auth) and [[Design]]");
    expect(await repository.git("show", "gitdesk:docs/Design/Backend.md")).toContain("[[Design/Backend/Auth]]");
    const snapshot = await latest();
    expect(snapshot.changes).toEqual([]);
    expect(snapshot.warnings).toEqual([]);
    expect(await repository.git("-C", path.join(repository.root, ".git", "gitdesk", "gitdesk"), "status", "--porcelain")).toBe("");
  });

  it("updates links where each area lives: tasks on the content branch, the wiki in the checkout", async () => {
    const { content, id, latest, repository } = await opened(LINKED);
    await content.setStorage(id, "tasks", "branch");
    await content.movePage(id, "docs/Architecture.md", "docs/Design.md", { updateLinks: true });
    expect(await repository.git("show", "--name-status", "--format=%s", "gitdesk")).toBe(
      "Move page Architecture to docs/Design.md\n\nM\ttasks/TP-1.md\n",
    );
    expect(await repository.git("show", "gitdesk:tasks/TP-1.md")).toContain("Read [[Design/Backend]].");
    expect(await repository.read("tasks/TP-1.md")).toBe(LINKED["tasks/TP-1.md"]);
    expect(await repository.read("docs/Home.md")).toContain("[[Design]]");
    const changes = (await latest()).changes.map((change) => change.path);
    expect(changes).toEqual(expect.arrayContaining(["docs/Home.md", "docs/Design.md"]));
    expect(changes).not.toContain("tasks/TP-1.md");
  });

  it("updates links where each area lives: the wiki on the content branch, tasks in the checkout", async () => {
    const { content, id, latest, repository } = await opened(LINKED);
    await content.setStorage(id, "wiki", "branch");
    await content.movePage(id, "docs/Architecture.md", "docs/Design.md", { updateLinks: true });
    const changed = await repository.git("show", "--name-status", "--format=%s", "gitdesk");
    expect(changed).toMatch(/^Move page Architecture to docs\/Design\.md\n/);
    expect(changed).not.toMatch(/tasks\//);
    expect(await repository.read("tasks/TP-1.md")).toContain("Read [[Design/Backend]].");
    expect((await latest()).changes.map((change) => change.path)).toEqual(["tasks/TP-1.md"]);
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

  it("starts tasks of a type from its template, which is not a task itself", async () => {
    const { content, id, latest, repository } = await opened({
      ".gitdesk.yml": "name: T\ntaskPrefix: TP\n",
      "tasks/.templates/bug.md": "---\npriority: urgent\nseverity: major\n---\n\n## Steps\n",
    });
    expect(await latest()).toMatchObject({ tasks: [], warnings: [] });
    expect(await content.taskTemplate(id, "feature")).toBeNull();
    const template = (await content.taskTemplate(id, "bug"))!;
    expect(template).toEqual({ body: "## Steps\n", priority: "urgent", fields: { severity: "major" } });
    const task = await content.createTask(id, { ...input, ...template, type: "bug" });
    expect(task).toMatchObject({ type: "bug", priority: "urgent", fields: { severity: "major" } });
    expect(await repository.read(task.path)).toBe(
      "---\nid: TP-1\ntitle: Build it\ntype: bug\nstatus: backlog\npriority: urgent\nassignee: alice\nlabels:\n  - backend\nseverity: major\n---\n\n## Steps\n",
    );
    await expect(content.taskTemplate(id, "../bug")).rejects.toThrow("Invalid task type");
    await expect(content.updateTask(id, "tasks/.templates/bug.md", input, "x")).rejects.toThrow("inside tasks/");
  });

  it("creates a type's template once, for editing", async () => {
    const { content, id, repository } = await opened();
    const path = await content.ensureTaskTemplate(id, "bug");
    expect(path).toBe("tasks/.templates/bug.md");
    expect(await repository.read(path)).toContain("New bug tasks start with");
    await repository.write(path, "Mine\n");
    expect(await content.ensureTaskTemplate(id, "bug")).toBe(path);
    expect(await repository.read(path)).toBe("Mine\n");
  });

  it("keeps templates with the tasks on the content branch", async () => {
    const { content, id, repository } = await opened();
    await content.setStorage(id, "tasks", "branch");
    const path = await content.ensureTaskTemplate(id, "bug");
    expect(await repository.git("show", "--name-status", "--format=%s", "gitdesk")).toBe(`Create the bug task template\n\nA\t${path}\n`);
    expect(await repository.exists(path)).toBe(false);
    expect((await content.taskTemplate(id, "bug"))!.body).toContain("## Steps to reproduce");
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
    // The epic folder it left is gone, empty.
    expect(await repository.exists("tasks/Login rework")).toBe(false);
    const back = await content.updateTask(id, moved.path, { ...input, epic: "" }, moved.hash);
    expect(back.path).toBe("tasks/TP-1.md");
    expect(await repository.exists("tasks/Billing")).toBe(false);
    expect(await repository.exists("tasks")).toBe(true);
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

  it("adds comments below the description, signed with the Git user name", async () => {
    const { content, id, repository } = await opened();
    await repository.git("config", "user.name", "Ada Lovelace");
    const task = await content.createTask(id, input);
    expect(await content.commentAuthor(id)).toBe("Ada Lovelace");
    const commented = await content.addComment(id, task.path, "  Looks good, see [[TP-2]].\n");
    expect(commented.body).toBe(input.body);
    expect(commented.comments).toEqual([
      { author: "Ada Lovelace", date: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d/), body: "Looks good, see [[TP-2]]." },
    ]);
    expect(await repository.read(task.path)).toMatch(
      /- \[ \] Done\n\n## Comments\n\n### Ada Lovelace — \d{4}-\d\d-\d\d \d\d:\d\d[+-]\d\d:\d\d\n\nLooks good/,
    );
    // Editing the description keeps the comments, and comments are appended to whatever the file holds now.
    const edited = await content.updateTask(id, task.path, { ...input, body: "Changed.\n" }, commented.hash);
    expect(edited.comments).toHaveLength(1);
    const again = await content.addComment(id, task.path, "Second");
    expect(again.comments.map((comment) => comment.body)).toEqual(["Looks good, see [[TP-2]].", "Second"]);
    expect(again.body).toBe("Changed.\n");
    await expect(content.addComment(id, task.path, " ")).rejects.toThrow("Write a comment first.");
    await expect(content.addComment(id, "docs/Home.md", "x")).rejects.toThrow("inside tasks/");
  });

  it("lists the people: commit authors, assignees, comment authors and the people of the settings", async () => {
    const { content, id, repository } = await opened();
    await repository.write("x.txt", "x");
    await repository.git("add", "x.txt");
    await repository.git("commit", "-q", "-m", "By Ada", "--author=Ada <ada@old.example>");
    await repository.write(".mailmap", "Ada Lovelace <ada@example.com> <ada@old.example>\n");
    const task = await content.createTask(id, { ...input, assignee: "sam" });
    await content.addComment(id, task.path, "Hello");
    await repository.write(
      ".gitdesk.yml",
      "name: Test Project\ntaskPrefix: TP\npeople:\n  - handle: tester\n    name: The Tester\n    email: test@example.com\n",
    );
    const { people, me } = await content.people(id);
    expect(people.map(({ handle, name, email, commits }) => ({ handle, name, email, commits }))).toEqual([
      { handle: "ada", name: "Ada Lovelace", email: "ada@example.com", commits: 1 },
      { handle: "sam", name: "sam", email: null, commits: 0 },
      // The settings' person is the author of the first commit and of the comment.
      { handle: "tester", name: "The Tester", email: "test@example.com", commits: 1 },
    ]);
    expect(me).toBe("tester");
    // Commit authors are read again once HEAD moves.
    await repository.git("commit", "-q", "--allow-empty", "-m", "By Bob", "--author=Bob <bob@example.com>");
    expect((await content.people(id)).people.map((person) => person.handle)).toContain("bob");
  });

  it("edits and deletes only the user's own comments, on the version they saw", async () => {
    const { content, id, repository } = await opened();
    const task = await content.createTask(id, input);
    await repository.git("config", "user.name", "Bob");
    const theirs = await content.addComment(id, task.path, "From Bob");
    await repository.git("config", "user.name", "Ada");
    const mine = await content.addComment(id, task.path, "From Ada");
    const edited = await content.editComment(id, task.path, 1, "Changed", mine.hash);
    expect(edited.comments.map((comment) => comment.body)).toEqual(["From Bob", "Changed"]);
    await expect(content.editComment(id, task.path, 1, "Stale", mine.hash)).rejects.toThrow("changed on disk");
    await expect(content.deleteComment(id, task.path, 0, edited.hash)).rejects.toThrow("your own comments");
    await expect(content.deleteComment(id, task.path, 5, edited.hash)).rejects.toThrow("no longer exists");
    await expect(content.deleteComment(id, task.path, -1, edited.hash)).rejects.toThrow("Invalid comment.");
    const deleted = await content.deleteComment(id, task.path, 1, edited.hash);
    expect(deleted.comments).toEqual([theirs.comments[0]]);
  });

  it("asks for a Git user name before signing comments", async () => {
    const { content, id, repository } = await opened();
    const task = await content.createTask(id, input);
    await repository.git("config", "user.useConfigOnly", "true");
    await repository.git("config", "user.name", "");
    await expect(content.addComment(id, task.path, "x")).rejects.toThrow("git config user.name");
  });

  it("tells who changed a task and how, following moves between epics", async () => {
    const { content, id, repository } = await opened();
    const commit = async (message: string) => {
      await repository.git("add", "-A");
      await repository.git("commit", "-q", "-m", message);
    };
    const task = await content.createTask(id, { ...input, status: "todo" });
    await commit("Add TP-1");
    const moved = await content.updateTask(id, task.path, { ...input, status: "in-progress", epic: "Auth" }, task.hash);
    await commit("Start TP-1");
    expect(moved.path).toBe("tasks/Auth/TP-1.md");
    await repository.git("config", "user.name", "Ada");
    const commented = await content.addComment(id, moved.path, "Hi");
    // Moved back to no epic and not committed yet: the activity still finds the history.
    await content.updateTask(id, moved.path, { ...input, status: "in-progress", epic: "" }, commented.hash);

    const activity = await content.taskActivity(id, "tasks/TP-1.md");
    expect(activity.map((entry) => [entry.commit === null, entry.author, entry.subject])).toEqual([
      [true, "Ada", ""],
      [false, "Test", "Start TP-1"],
      [false, "Test", "Add TP-1"],
    ]);
    expect(activity[0]).toMatchObject({ date: null });
    expect(activity[0]!.changes).toEqual([
      { kind: "field", field: "epic", from: "Auth", to: "" },
      { kind: "comments", added: 1, edited: 0, removed: 0 },
    ]);
    expect(activity[1]!.changes).toEqual([
      { kind: "field", field: "status", from: "todo", to: "in-progress" },
      { kind: "field", field: "epic", from: "", to: "Auth" },
    ]);
    expect(activity[2]!.changes).toEqual([{ kind: "created" }]);

    await commit("Comment on TP-1");
    expect((await content.taskActivity(id, "tasks/TP-1.md")).map((entry) => entry.subject)).toEqual([
      "Comment on TP-1",
      "Start TP-1",
      "Add TP-1",
    ]);
  });

  it("shows a task that was never committed as created, not committed yet", async () => {
    const { content, id } = await opened();
    const task = await content.createTask(id, input);
    expect(await content.taskActivity(id, task.path)).toEqual([
      { commit: null, author: "Test", date: null, subject: "", changes: [{ kind: "created" }] },
    ]);
  });

  it("never takes a template for an earlier version of a task with its name", async () => {
    const { content, id, repository } = await opened({
      ...DEFAULT_FILES,
      "tasks/.templates/bug.md": "---\npriority: high\n---\n\nSteps\n",
    });
    await repository.write("tasks/bug.md", "---\nid: TP-9\ntitle: Bug\nstatus: todo\n---\n\nBroken.\n");
    expect((await content.taskActivity(id, "tasks/bug.md")).map((entry) => entry.changes)).toEqual([[{ kind: "created" }]]);
  });

  it("reads the activity from the content branch, where every edit is a commit", async () => {
    const { content, id, repository } = await opened();
    await content.setStorage(id, "tasks", "branch");
    await repository.write("docs/Home.md", "# Home\n\nUncommitted.\n");
    const task = await content.createTask(id, input);
    const commented = await content.addComment(id, task.path, "Hi");
    await content.updateTask(id, task.path, { ...input, priority: "low" }, commented.hash);
    const activity = await content.taskActivity(id, task.path);
    expect(activity.map((entry) => [entry.subject, entry.changes])).toEqual([
      ["Update TP-1: Build it", [{ kind: "field", field: "priority", from: "high", to: "low" }]],
      ["Comment on TP-1", [{ kind: "comments", added: 1, edited: 0, removed: 0 }]],
      ["Create TP-1: Build it", [{ kind: "created" }]],
    ]);
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

  it("keeps every area on the content branch when asked", async () => {
    const { content, id, latest, repository } = await opened();
    expect((await latest()).storage).toEqual({ areas: { wiki: "checkout", tasks: "checkout", settings: "checkout" }, branch: null });
    for (const area of ["wiki", "tasks", "settings"] as const) await content.setStorage(id, area, "branch");
    expect((await latest()).storage).toEqual({
      areas: { wiki: "branch", tasks: "branch", settings: "branch" },
      branch: { name: "gitdesk", remote: null, ahead: 0, behind: 0 },
    });
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
    await expect(content.setStorage(id, "wiki", "cloud" as never)).rejects.toThrow("Invalid storage mode.");
    await expect(content.setStorage(id, "code" as never, "branch")).rejects.toThrow("Invalid content area.");
    for (const area of ["wiki", "tasks", "settings"] as const) await content.setStorage(id, area, "checkout");
    expect((await latest()).storage).toMatchObject({ areas: { wiki: "checkout", tasks: "checkout", settings: "checkout" } });
    expect(await repository.exists(task.path)).toBe(true);
  });

  it("keeps tasks on the content branch and the wiki in the checkout", async () => {
    const { content, id, latest, repository } = await opened();
    await repository.write("docs/pixel.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    await repository.git("add", "docs/pixel.png");
    await repository.git("commit", "-q", "-m", "Add an image");
    await content.setStorage(id, "tasks", "branch");
    const task = await content.createTask(id, input);
    await content.createPage(id, "docs/Notes.md");

    const snapshot = await latest();
    expect(snapshot.storage.areas).toEqual({ wiki: "checkout", tasks: "branch", settings: "checkout" });
    expect(snapshot.tasks.map((t) => t.id)).toEqual(["TP-1"]);
    expect(snapshot.wiki.map((node) => node.title)).toContain("Notes");
    expect(snapshot.changes.map((change) => change.path)).toEqual(["docs/Notes.md"]);
    expect(await repository.exists(task.path)).toBe(false);
    expect((await repository.git("log", "-1", "--format=%s", "gitdesk")).trim()).toBe("Create TP-1: Build it");
    expect((await content.read(id, "content", task.path)).content).toContain("title: Build it");
    expect(await content.image(id, "content", "docs/pixel.png")).toBe("data:image/png;base64,iVBORw==");
  });

  it("syncs the content branch with the remote", async () => {
    const { content, versionControl, id, latest } = await opened();
    await versionControl.setRemote(id, "origin", await createRemote());
    await content.setStorage(id, "tasks", "branch");
    await content.syncContent(id);
    expect((await latest()).storage.branch).toMatchObject({ remote: "origin" });
  });

  it("warns when content edits could not be committed", async () => {
    const { content, id, latest, repository } = await opened();
    await content.setStorage(id, "wiki", "branch");
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
    await shareEverything(content, id);
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
    ["stash message", (m: Managers, id: string) => m.versionControl.stash(id, { message: "a\nb" } as never), "one line"],
    ["stash", (m: Managers, id: string) => m.versionControl.applyStash(id, "stash@{0}", false), "Invalid stash."],
    ["start point", (m: Managers, id: string) => m.versionControl.createBranch(id, "x", "HEAD~1"), "Choose a branch, tag or commit."],
    ["start commit", (m: Managers, id: string) => m.versionControl.createBranch(id, "x", "a".repeat(40)), "Choose a branch, tag"],
    ["branch to delete", (m: Managers, id: string) => m.versionControl.deleteBranch(id, "--all", true), "Choose a branch."],
    ["remote branch", (m: Managers, id: string) => m.versionControl.deleteRemoteBranch(id, "origin/x"), "Choose a remote branch."],
    ["upstream", (m: Managers, id: string) => m.versionControl.setUpstream(id, "main", "main"), "Choose a remote branch."],
    ["tag name", (m: Managers, id: string) => m.versionControl.createTag(id, "bad..tag", "main", ""), "not a valid tag name"],
    ["tag option", (m: Managers, id: string) => m.versionControl.createTag(id, "-d", "main", ""), "Invalid tag name."],
    ["tag", (m: Managers, id: string) => m.versionControl.deleteTag(id, "missing"), "Choose a tag."],
    ["merge source", (m: Managers, id: string) => m.versionControl.merge(id, "--abort", { noFastForward: false, message: "" }), "Choose a"],
    ["resolution", (m: Managers, id: string) => m.versionControl.resolveConflict(id, "a", { use: "mine" } as never), "Invalid resolution."],
    ["conflict path", (m: Managers, id: string) => m.versionControl.resolveConflict(id, "../a", { use: "ours" }), "path"],
    [
      "unconflicted file",
      (m: Managers, id: string) => m.versionControl.resolveConflict(id, "src/code.ts", { use: "ours" }),
      "no conflicts",
    ],
    ["continue", (m: Managers, id: string) => m.versionControl.continueOperation(id), "No merge, rebase"],
    ["rebase base", (m: Managers, id: string) => m.versionControl.rebaseInteractive(id, "main", [], false), "Choose a commit"],
    ["rebase onto", (m: Managers, id: string) => m.versionControl.rebase(id, "--root", false), "Choose a branch, tag or commit."],
    ["cherry-pick", (m: Managers, id: string) => m.versionControl.cherryPick(id, "HEAD"), "Invalid commit ID."],
  ])("rejects an invalid %s", async (_, call, message) => {
    const { managers, id } = await opened();
    await expect(call(managers, id)).rejects.toThrow(message);
  });

  it("refuses refs a clone brought whose names look like options", async () => {
    const origin = await createRepository();
    const evil = "--exec=touch${IFS}PWNED";
    await origin.git("update-ref", `refs/tags/${evil}`, "HEAD");
    await origin.git("update-ref", `refs/heads/${evil}`, "HEAD");
    await origin.git("update-ref", `refs/heads/feature/-f`, "HEAD");
    const repository = await cloneRepository(origin.root);
    await repository.write("local.md", "local");
    await repository.git("add", ".");
    await repository.git("commit", "-q", "-m", "Local");
    const { workspace, versionControl } = await backend();
    const { id } = await workspace.open({ kind: "local", path: repository.root });
    const refused = "looks like an option";
    await expect(versionControl.rebase(id, evil, false)).rejects.toThrow(refused);
    await expect(versionControl.merge(id, `origin/${evil}`, { noFastForward: false, message: "" })).rejects.toThrow(refused);
    await expect(versionControl.rebasePlan(id, evil)).rejects.toThrow(refused);
    await expect(versionControl.createBranch(id, "copy", evil)).rejects.toThrow(refused);
    await expect(versionControl.createTag(id, "copy", evil, "")).rejects.toThrow(refused);
    await expect(versionControl.deleteTag(id, evil)).rejects.toThrow(refused);
    await expect(versionControl.pushTag(id, evil, "origin")).rejects.toThrow(refused);
    // Switching to a remote-only branch creates a local branch named after its last part.
    await expect(versionControl.switchBranch(id, `origin/${evil}`)).rejects.toThrow(refused);
    await expect(versionControl.switchBranch(id, "origin/feature/-f")).rejects.toThrow(refused);
    await expect(versionControl.deleteRemoteBranch(id, `origin/${evil}`)).rejects.toThrow(refused);
    await expect(versionControl.setUpstream(id, "main", `origin/${evil}`)).rejects.toThrow(refused);
    await repository.git("branch", "--end-of-options", "feature/-f", "HEAD");
    await expect(versionControl.deleteBranch(id, "feature/-f", true)).rejects.toThrow(refused);
    await expect(versionControl.renameBranch(id, "feature/-f", "fine")).rejects.toThrow(refused);
    expect(await repository.exists("PWNED")).toBe(false);
    expect(await versionControl.rebase(id, "origin/main", false)).toBe("done");
  });

  it("creates and switches branches", async () => {
    const { versionControl, id, latest } = await opened();
    await versionControl.createBranch(id, "feature/x");
    expect((await latest()).head.branch).toBe("feature/x");
    await versionControl.switchBranch(id, "main");
    expect((await latest()).branches).toEqual(["feature/x", "main"]);
  });

  it("manages branches and tags at commits", async () => {
    const { versionControl, id, latest, repository } = await opened();
    const [initial] = await versionControl.log(id, 0, 1);
    await versionControl.createBranch(id, "at-initial", initial!.hash, false);
    expect((await latest()).head.branch).toBe("main");
    await versionControl.renameBranch(id, "at-initial", "renamed");
    await versionControl.createTag(id, "v1", initial!.hash, "First release");
    expect(await latest()).toMatchObject({ branches: ["main", "renamed"], tags: ["v1"] });
    expect(await versionControl.deleteBranch(id, "renamed", false)).toBe(true);
    await versionControl.deleteTag(id, "v1");
    expect(await latest()).toMatchObject({ branches: ["main"], tags: [] });
    expect(await repository.git("tag")).toBe("");
  });

  it("merges with a conflict, shows it in the snapshot, and continues once it is resolved", async () => {
    const { versionControl, id, latest, repository } = await opened();
    await repository.git("switch", "-q", "-c", "feature");
    await repository.write("src/code.ts", "feature\n");
    await repository.git("commit", "-qam", "Feature");
    await repository.git("switch", "-q", "main");
    await repository.write("src/code.ts", "main\n");
    await repository.git("commit", "-qam", "Main");

    expect(await versionControl.merge(id, "feature", { noFastForward: false, message: "" })).toBe("stopped");
    const snapshot = await latest();
    expect(snapshot.operation).toEqual({ kind: "merge", source: "feature", target: "main", step: null, steps: null });
    expect(snapshot.changes).toEqual([expect.objectContaining({ path: "src/code.ts", conflict: "both-modified" })]);
    expect((await versionControl.conflict(id, "src/code.ts")).text).toContain(">>>>>>> feature");
    await versionControl.resolveConflict(id, "src/code.ts", { use: "theirs" });
    expect(await versionControl.continueOperation(id)).toBe("done");
    expect(await latest()).toMatchObject({ operation: null, changes: [] });
    expect(await repository.read("src/code.ts")).toBe("feature\n");
  });

  it("starts no merge, rebase, pick, revert or stash apply while another operation is unfinished", async () => {
    const { versionControl, id, repository } = await opened();
    await repository.git("switch", "-q", "-c", "feature");
    await repository.write("src/code.ts", "feature\n");
    await repository.git("commit", "-qam", "Feature");
    const feature = (await repository.git("rev-parse", "HEAD")).trim();
    await repository.git("switch", "-q", "main");
    await repository.write("src/code.ts", "main\n");
    await repository.git("commit", "-qam", "Main");
    await repository.write("other.txt", "stashed");
    await versionControl.stash(id, { message: "", includeUntracked: true, keepIndex: false });
    const stash = (await repository.git("rev-parse", "stash@{0}")).trim();
    const initial = (await repository.git("rev-parse", "HEAD~1")).trim();
    const refused = async () => {
      for (const attempt of [
        () => versionControl.merge(id, "feature", { noFastForward: false, message: "" }),
        () => versionControl.rebase(id, "feature", true),
        () => versionControl.pullRebase(id, "origin", true),
        () => versionControl.rebaseInteractive(id, initial, [{ hash: feature, action: "pick" }], true),
        () => versionControl.cherryPick(id, feature),
        () => versionControl.revert(id, feature),
        () => versionControl.applyStash(id, stash, false),
      ])
        await expect(attempt()).rejects.toThrow("Finish or abort the merge first.");
    };

    expect(await versionControl.merge(id, "feature", { noFastForward: false, message: "" })).toBe("stopped");
    await refused();
    // Resolved, the merge still waits to be continued.
    await versionControl.resolveConflict(id, "src/code.ts", { use: "theirs" });
    await refused();
    await versionControl.abortOperation(id);
    expect(await versionControl.applyStash(id, stash, false)).toBe("done");
  });

  it("rebases interactively, squashing and rewording through the contract", async () => {
    const { versionControl, id, repository } = await opened();
    const base = (await repository.git("rev-parse", "HEAD")).trim();
    for (const name of ["One", "Two", "Three"]) {
      await repository.write(`${name}.txt`, name);
      await repository.git("add", ".");
      await repository.git("commit", "-q", "-m", name);
    }
    const plan = await versionControl.rebasePlan(id, base);
    expect(plan.commits.map((commit) => commit.subject)).toEqual(["One", "Two", "Three"]);
    const [one, two, three] = plan.commits.map((commit) => commit.hash);
    await repository.write("src/code.ts", "dirty");
    const steps = [
      { hash: three!, action: "reword" as const, message: "Three, first" },
      { hash: one!, action: "pick" as const },
      { hash: two!, action: "squash" as const, message: "One and two" },
    ];
    await expect(versionControl.rebaseInteractive(id, base, steps, false)).rejects.toThrow("Commit or stash your changes first.");
    expect(await versionControl.rebaseInteractive(id, base, steps, true)).toBe("done");
    expect((await repository.git("log", "--format=%s", `${base}..HEAD`)).trim().split("\n")).toEqual(["One and two", "Three, first"]);
    expect(await repository.read("src/code.ts")).toBe("dirty");
    await expect(versionControl.rebaseInteractive(id, base, steps, true)).rejects.toThrow("The commits changed meanwhile.");
  });

  it("cherry-picks and reverts commits, but not merges", async () => {
    const { versionControl, id, repository } = await opened();
    await repository.git("switch", "-q", "-c", "feature");
    await repository.write("picked.txt", "picked");
    await repository.git("add", ".");
    await repository.git("commit", "-q", "-m", "Pick me");
    const picked = (await repository.git("rev-parse", "HEAD")).trim();
    await repository.git("switch", "-q", "main");
    expect(await versionControl.cherryPick(id, picked)).toBe("done");
    expect(await repository.read("picked.txt")).toBe("picked");
    expect(await versionControl.revert(id, (await repository.git("rev-parse", "HEAD")).trim())).toBe("done");
    expect(await repository.exists("picked.txt")).toBe(false);
    expect((await repository.git("log", "-1", "--format=%s")).trim()).toBe('Revert "Pick me"');
    await repository.git("switch", "-q", "-c", "other");
    await repository.write("other.txt", "other");
    await repository.git("add", ".");
    await repository.git("commit", "-q", "-m", "Other");
    await repository.git("switch", "-q", "main");
    await repository.git("merge", "-q", "--no-ff", "-m", "Merge", "other");
    const merge = (await repository.git("rev-parse", "HEAD")).trim();
    await expect(versionControl.revert(id, merge)).rejects.toThrow("merge commits");
    // A commit the branch has already is not picked again.
    const other = (await repository.git("rev-parse", "other")).trim();
    await expect(versionControl.cherryPick(id, other)).rejects.toThrow(`${other.slice(0, 7)} is already on main.`);
    expect(await versionControl.continueOperation(id).catch((error: Error) => error.message)).toMatch("No merge, rebase");
  });

  it("stashes changes, shows and pops them", async () => {
    const { versionControl, id, latest, repository } = await opened();
    const stashOptions = { message: "", includeUntracked: true, keepIndex: false };
    await expect(versionControl.stash(id, stashOptions)).rejects.toThrow("There are no changes to stash.");
    await repository.write("new.txt", "new");
    await expect(versionControl.stash(id, { ...stashOptions, includeUntracked: false })).rejects.toThrow("no changes to stash");
    await versionControl.stash(id, { ...stashOptions, message: "  Untracked  " });
    const { stashes, changes } = await latest();
    expect(changes).toEqual([]);
    expect(stashes).toEqual([expect.objectContaining({ index: 0, message: "Untracked", branch: "main" })]);
    const detail = await versionControl.stashDetail(id, stashes[0]!.hash);
    expect(detail.files.map((file) => file.path)).toEqual(["new.txt"]);
    expect(await versionControl.applyStash(id, stashes[0]!.hash, true)).toBe("done");
    expect(await repository.read("new.txt")).toBe("new");
    expect((await latest()).stashes).toEqual([]);
    await expect(versionControl.dropStash(id, stashes[0]!.hash)).rejects.toThrow("This stash no longer exists.");
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
