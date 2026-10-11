import { describe, expect, it } from "vitest";
import type { ContentArea } from "../../contracts/model";
import { nodeMachine } from "../../platforms/node/node-machine";
import { cloneRepository, createRemote, createRepository, DEFAULT_FILES } from "../../testing/repository";
import { FileStore } from "../files/file-store";
import { Git } from "../git/git";
import { LocalHost } from "../hosts/local-host";
import { ContentStore } from "./content-store";

const host = new LocalHost(nodeMachine());
const FOLDERS: Readonly<Record<ContentArea, string>> = { wiki: "docs", tasks: "tasks", settings: ".gitdesk.yml" };
const FILES = { ...DEFAULT_FILES, "tasks/TP-1.md": "---\nid: TP-1\ntitle: First\n---\n" };

function storeFor(root: string) {
  const normalized = host.paths.normalize(root);
  return new ContentStore(host, new Git(host, normalized), new FileStore(host, normalized));
}

async function move(store: ContentStore, areas: readonly ContentArea[], mode: "checkout" | "branch") {
  for (const area of areas) await store.setStorage(area, mode, FOLDERS[area]);
}

const everyArea: readonly ContentArea[] = ["wiki", "tasks", "settings"];

/** Saves `content` at `path` wherever its area lives and records the edit. */
async function edit(store: ContentStore, area: ContentArea, path: string, content: string, message = `Edit ${path}`) {
  const { files } = await store.locate(area);
  await files.write(path, content, await files.versionOf(path));
  await store.record(area, [path], message);
}

const lf = (text: string) => text.replace(/\r\n/g, "\n");

describe("ContentStore in the checkout", () => {
  it("uses the checkout for every area and never commits", async () => {
    const repository = await createRepository();
    const store = storeFor(repository.root);
    expect(await store.layout()).toEqual({ areas: { wiki: "checkout", tasks: "checkout", settings: "checkout" }, branch: null });
    const location = await store.locate("wiki");
    expect(location.branch).toBeNull();
    expect(location.root).toBe(host.paths.normalize(repository.root));
    expect(await store.branchState()).toBeNull();
    await edit(store, "wiki", "docs/New.md", "x");
    expect((await repository.git("status", "--porcelain")).trim()).toBe("?? docs/New.md");
    await expect(store.sync()).rejects.toThrow("stored in the checkout");
  });
});

describe("ContentStore history", () => {
  const task = (status: string) => `---\nid: TP-1\ntitle: T\nstatus: ${status}\n---\n\nText\n`;

  it("follows a file across moves, with both versions of every commit", async () => {
    const repository = await createRepository({ "tasks/TP-1.md": task("todo") });
    const rename = async (from: string, to: string, content: string, message: string) => {
      await repository.write(to, content);
      await repository.git("rm", "-q", from);
      await repository.git("add", "-A");
      await repository.git("commit", "-q", "-m", message);
    };
    await rename("tasks/TP-1.md", "tasks/Auth/TP-1.md", task("done"), "Move TP-1 to Auth");
    await rename("tasks/Auth/TP-1.md", "tasks/Billing/TP-1.md", task("done"), "Move TP-1 to Billing");
    const store = storeFor(repository.root);
    const revisions = await store.history("tasks", "tasks/Billing/TP-1.md", 100, true);
    expect(revisions.map((revision) => [revision.subject, revision.oldPath, revision.path, revision.author])).toEqual([
      ["Move TP-1 to Billing", "tasks/Auth/TP-1.md", "tasks/Billing/TP-1.md", "Test"],
      ["Move TP-1 to Auth", "tasks/TP-1.md", "tasks/Auth/TP-1.md", "Test"],
      ["Initial commit", null, "tasks/TP-1.md", "Test"],
    ]);
    expect(revisions[1]).toMatchObject({ before: task("todo"), after: task("done") });
    expect(revisions[2]).toMatchObject({ before: null, after: task("todo") });
    expect((await store.history("tasks", "tasks/Billing/TP-1.md", 1, false)).map((revision) => [revision.oldPath, revision.after])).toEqual(
      [["tasks/Auth/TP-1.md", null]],
    );
  });

  it("reads the committed version and committed files", async () => {
    const repository = await createRepository({ "tasks/TP-1.md": task("todo"), "tasks/A/TP-2.md": task("todo") });
    await repository.write("tasks/TP-1.md", task("done"));
    const store = storeFor(repository.root);
    expect(await store.committed("tasks", "tasks/TP-1.md")).toBe(task("todo"));
    expect(await store.committed("tasks", "tasks/TP-3.md")).toBeNull();
    expect((await store.committedFiles("tasks", "tasks")).sort()).toEqual(["tasks/A/TP-2.md", "tasks/TP-1.md"]);
  });

  it("has no history before the first commit", async () => {
    const repository = await createRepository({ "tasks/TP-1.md": task("todo") }, false);
    const store = storeFor(repository.root);
    expect(await store.history("tasks", "tasks/TP-1.md", 100, true)).toEqual([]);
    expect(await store.committed("tasks", "tasks/TP-1.md")).toBeNull();
    expect(await store.committedFiles("tasks", "tasks")).toEqual([]);
  });

  it("reads the history where the area lives", async () => {
    const repository = await createRepository();
    const store = storeFor(repository.root);
    await move(store, ["tasks"], "branch");
    await edit(store, "tasks", "tasks/TP-1.md", task("todo"), "Create TP-1");
    await edit(store, "tasks", "tasks/TP-1.md", task("done"), "Update TP-1");
    await edit(store, "wiki", "docs/Home.md", "# Home\n\nLocal.\n");
    expect((await store.history("tasks", "tasks/TP-1.md", 100, true)).map((revision) => revision.subject)).toEqual([
      "Update TP-1",
      "Create TP-1",
    ]);
    expect(await store.committed("tasks", "tasks/TP-1.md")).toBe(task("done"));
    expect((await store.history("wiki", "docs/Home.md", 100, false)).map((revision) => revision.subject)).toEqual(["Initial commit"]);
    expect(await store.committed("wiki", "docs/Home.md")).toBe("# Home\n");
  });

  it("names the author Git signs commits with", async () => {
    const repository = await createRepository();
    await repository.git("config", "user.name", "Ada Lovelace");
    expect(await storeFor(repository.root).author()).toBe("Ada Lovelace");
    await repository.git("config", "user.useConfigOnly", "true");
    await repository.git("config", "user.name", "");
    expect(await storeFor(repository.root).author()).toBeNull();
  });
});

describe("ContentStore with every area on the content branch", () => {
  it("copies the committed content into a new branch worktree and commits every edit", async () => {
    const repository = await createRepository();
    const store = storeFor(repository.root);
    await move(store, everyArea, "branch");
    const location = await store.locate("wiki");
    expect(location.branch).toBe("gitdesk");
    expect(location.root).not.toBe(host.paths.normalize(repository.root));
    expect((await store.files("wiki")).sort()).toEqual([
      ".gitdesk-content",
      ".gitdesk.yml",
      "docs/Architecture.md",
      "docs/Architecture/Backend.md",
      "docs/Architecture/Backend/Auth.md",
      "docs/Home.md",
    ]);

    await edit(store, "wiki", "docs/Home.md", "# Home\n\nShared.\n");
    expect((await repository.git("log", "--format=%s", "gitdesk")).trim().split("\n")).toEqual([
      "Edit docs/Home.md",
      "Move settings to the content branch",
      "Move tasks to the content branch",
      "Move the wiki to the content branch",
      "Start the GitDesk content branch",
    ]);
    expect((await repository.git("status", "--porcelain")).trim()).toBe("");
    expect(await store.branchState()).toMatchObject({ branch: "gitdesk", remote: null, uncommitted: 0 });
  });

  it("starts an empty branch in a repository without commits", async () => {
    const repository = await createRepository({}, false);
    const store = storeFor(repository.root);
    await move(store, everyArea, "branch");
    expect(await store.files("wiki")).toEqual([".gitdesk-content"]);
  });

  it("reads a content branch without a list of areas, as earlier versions made it, as holding every area", async () => {
    const repository = await createRepository();
    const store = storeFor(repository.root);
    await move(store, ["wiki"], "branch");
    const { git } = await store.locate("wiki");
    await git.text(["rm", "--quiet", ".gitdesk-content"]);
    await git.text(["commit", "--quiet", "-m", "Forget the areas"]);
    expect((await store.layout()).areas).toEqual({ wiki: "branch", tasks: "branch", settings: "branch" });
  });

  it("reports conflicting edits and leaves no rebase behind", async () => {
    const repository = await createRepository();
    const remote = await createRemote();
    await repository.git("remote", "add", "origin", remote);
    const store = storeFor(repository.root);
    await move(store, everyArea, "branch");
    await store.sync();
    const theirs = storeFor((await cloneRepository(remote)).root);
    await edit(theirs, "wiki", "docs/Home.md", "theirs\n");
    await theirs.sync();
    await edit(store, "wiki", "docs/Home.md", "mine\n");
    await expect(store.sync()).rejects.toThrow("conflict with origin/gitdesk");
    const location = await store.locate("wiki");
    expect(await location.git.attempt(["rev-parse", "--verify", "--quiet", "REBASE_HEAD"])).toBeNull();
  });

  it("remembers a failing auto-commit and commits the edit later", async () => {
    const repository = await createRepository();
    const store = storeFor(repository.root);
    await move(store, everyArea, "branch");
    await repository.git("config", "user.useConfigOnly", "true");
    await repository.git("config", "user.name", "");
    await edit(store, "wiki", "docs/Home.md", "offline\n");
    expect(store.commitFailure).toBeTruthy();

    await repository.git("config", "user.name", "Test");
    await edit(store, "wiki", "docs/New.md", "x");
    expect(store.commitFailure).toBeNull();
    expect(await repository.git("log", "--format=%s", "gitdesk")).toMatch(/Commit pending GitDesk edits/);
  });

  it("switches back to the checkout and leaves a consistent repository", async () => {
    const repository = await createRepository();
    const store = storeFor(repository.root);
    await move(store, everyArea, "branch");
    await move(store, everyArea, "checkout");
    expect((await store.locate("wiki")).branch).toBeNull();
    expect((await store.layout()).areas).toEqual({ wiki: "checkout", tasks: "checkout", settings: "checkout" });
    expect((await repository.git("status", "--porcelain")).trim()).toBe("");
    expect(await repository.git("fsck", "--no-progress")).not.toMatch(/missing/);
  });

  it("repairs the worktree after the repository moved", async () => {
    const repository = await createRepository();
    await move(storeFor(repository.root), everyArea, "branch");
    const moved = repository.root + "-moved";
    const { promises: fs } = await import("node:fs");
    await fs.rename(repository.root, moved);
    const { onTestFinished } = await import("vitest");
    onTestFinished(() => fs.rm(moved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => undefined));
    const location = await storeFor(moved).locate("wiki");
    expect(location.root.startsWith(host.paths.normalize(moved))).toBe(true);
    expect((await location.files.read("docs/Home.md")).content).toContain("# Home");
  });
});

describe("ContentStore with some areas on the content branch", () => {
  it("keeps tasks on the branch and the wiki in the checkout", async () => {
    const repository = await createRepository(FILES);
    const store = storeFor(repository.root);
    await move(store, ["tasks"], "branch");
    expect((await store.layout()).areas).toEqual({ wiki: "checkout", tasks: "branch", settings: "checkout" });
    expect((await store.locate("wiki")).branch).toBeNull();
    expect((await store.locate("settings")).branch).toBeNull();
    expect((await store.files("tasks")).sort()).toEqual([".gitdesk-content", "tasks/TP-1.md"]);

    await edit(store, "tasks", "tasks/TP-2.md", "---\nid: TP-2\ntitle: Second\n---\n", "Create TP-2");
    await edit(store, "wiki", "docs/New.md", "# New\n");
    expect((await repository.git("status", "--porcelain")).trim()).toBe("?? docs/New.md");
    expect((await repository.git("log", "--format=%s", "gitdesk")).trim().split("\n")).toEqual([
      "Create TP-2",
      "Move tasks to the content branch",
      "Start the GitDesk content branch",
    ]);
  });

  it("empties the branch's copy of an area the checked-out commit has no files of", async () => {
    const repository = await createRepository(FILES);
    const store = storeFor(repository.root);
    await move(store, ["tasks"], "branch");
    await move(store, ["tasks"], "checkout");
    await repository.git("rm", "-q", "-r", "tasks");
    await repository.git("commit", "-q", "-m", "Remove the tasks");
    await move(store, ["tasks"], "branch");
    expect((await store.files("tasks")).filter((file) => file.startsWith("tasks/"))).toEqual([]);
    expect(await repository.git("ls-tree", "-r", "--name-only", "gitdesk", "--", "tasks")).toBe("");
  });

  it("deletes the checkout's files of an area the branch has none of, as uncommitted changes", async () => {
    const repository = await createRepository(FILES);
    const store = storeFor(repository.root);
    await move(store, ["tasks"], "branch");
    const { files } = await store.locate("tasks");
    await files.remove("tasks/TP-1.md");
    await store.record("tasks", ["tasks/TP-1.md"], "Delete TP-1");
    await move(store, ["tasks"], "checkout");
    expect(await repository.exists("tasks/TP-1.md")).toBe(false);
    expect((await repository.git("status", "--porcelain")).trim()).toBe("D tasks/TP-1.md");
  });

  it("keeps the wiki on the branch and tasks in the checkout", async () => {
    const repository = await createRepository(FILES);
    const store = storeFor(repository.root);
    await move(store, ["wiki"], "branch");
    expect((await store.layout()).areas).toEqual({ wiki: "branch", tasks: "checkout", settings: "checkout" });
    expect((await store.files("wiki")).filter((file) => file.startsWith("tasks/"))).toEqual([]);

    await edit(store, "wiki", "docs/Home.md", "# Home\n\nShared.\n");
    await edit(store, "tasks", "tasks/TP-1.md", "---\nid: TP-1\ntitle: Changed\n---\n");
    expect((await repository.git("status", "--porcelain")).trim()).toBe("M tasks/TP-1.md");
    expect(await repository.git("show", "gitdesk:docs/Home.md")).toContain("Shared.");
  });

  it("syncs only the areas on the branch, and another clone picks the layout up", async () => {
    const repository = await createRepository(FILES);
    const remote = await createRemote();
    await repository.git("remote", "add", "origin", remote);
    await repository.git("push", "-q", "origin", "main");
    const store = storeFor(repository.root);
    await move(store, ["tasks"], "branch");
    await edit(store, "tasks", "tasks/TP-1.md", "---\nid: TP-1\ntitle: Shared\n---\n");
    await edit(store, "wiki", "docs/Home.md", "# Home\n\nLocal.\n");
    await store.sync();

    expect(await store.branchState()).toMatchObject({ remote: "origin", head: { ahead: 0, behind: 0 }, uncommitted: 0 });
    const pushed = await repository.git("ls-tree", "-r", "--name-only", "origin/gitdesk");
    expect(pushed.trim().split("\n").sort()).toEqual([".gitdesk-content", "tasks/TP-1.md"]);
    expect((await repository.git("status", "--porcelain")).trim()).toBe("M docs/Home.md");

    const theirs = storeFor((await cloneRepository(remote)).root);
    expect((await theirs.layout()).areas).toEqual({ wiki: "checkout", tasks: "branch", settings: "checkout" });
    expect(lf((await (await theirs.locate("tasks")).files.read("tasks/TP-1.md")).content)).toContain("title: Shared");
    expect(lf((await (await theirs.locate("wiki")).files.read("docs/Home.md")).content)).toBe("# Home\n");
  });

  it("moves an area back into the checkout as uncommitted changes and keeps the branch's copy", async () => {
    const repository = await createRepository(FILES);
    const store = storeFor(repository.root);
    await move(store, ["tasks"], "branch");
    await edit(store, "tasks", "tasks/TP-1.md", "---\nid: TP-1\ntitle: Edited on the branch\n---\n");
    await edit(store, "tasks", "tasks/TP-2.md", "---\nid: TP-2\ntitle: New\n---\n");
    await move(store, ["tasks"], "checkout");

    expect((await store.layout()).areas.tasks).toBe("checkout");
    expect(lf(await repository.read("tasks/TP-1.md"))).toContain("Edited on the branch");
    expect((await repository.git("status", "--porcelain")).trimEnd().split("\n")).toEqual([" M tasks/TP-1.md", "?? tasks/TP-2.md"]);
    expect(await repository.git("show", "gitdesk:tasks/TP-2.md")).toContain("title: New");
    expect((await repository.git("log", "-1", "--format=%s", "gitdesk")).trim()).toBe("Move tasks to the checkout");
  });

  it("gives an area that moves to the branch again the checkout's committed files", async () => {
    const repository = await createRepository(FILES);
    const store = storeFor(repository.root);
    await move(store, ["tasks"], "branch");
    await move(store, ["tasks"], "checkout");
    await repository.git("rm", "-q", "tasks/TP-1.md");
    await repository.write("tasks/TP-3.md", "---\nid: TP-3\ntitle: Third\n---\n");
    await repository.git("add", "tasks");
    await repository.git("commit", "-q", "-m", "Rework tasks");
    await move(store, ["tasks"], "branch");
    expect((await store.files("tasks")).filter((file) => file.startsWith("tasks/"))).toEqual(["tasks/TP-3.md"]);
    expect(await repository.git("log", "--format=%s", "gitdesk", "--", "tasks/TP-1.md")).toContain("Move tasks to the content branch");
  });

  it("refuses to move an area with uncommitted changes in the checkout", async () => {
    const repository = await createRepository(FILES);
    const store = storeFor(repository.root);
    await repository.write("tasks/TP-1.md", "changed\n");
    await expect(store.setStorage("tasks", "branch", "tasks")).rejects.toThrow("Commit or discard the changes in tasks first");
    expect(await store.layout()).toMatchObject({ branch: null });

    await repository.git("checkout", "--", "tasks");
    await move(store, ["tasks"], "branch");
    await repository.write("tasks/TP-9.md", "untracked\n");
    await expect(store.setStorage("tasks", "checkout", "tasks")).rejects.toThrow("Commit or discard the changes in tasks first");
    expect((await store.layout()).areas.tasks).toBe("branch");
  });

  it("lets a clone opt out, and a later choice returns it to the team's layout", async () => {
    const repository = await createRepository(FILES);
    const store = storeFor(repository.root);
    await move(store, ["wiki"], "branch");
    await repository.git("config", "gitdesk.storage", "worktree");
    expect(await store.layout()).toMatchObject({ areas: { wiki: "checkout", tasks: "checkout" }, branch: null });

    await move(store, ["tasks"], "branch");
    expect((await store.layout()).areas).toEqual({ wiki: "branch", tasks: "branch", settings: "checkout" });
    expect(await repository.git("config", "--get", "gitdesk.storage").catch(() => "")).toBe("");
  });
});
