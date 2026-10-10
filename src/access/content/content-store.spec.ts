import { describe, expect, it } from "vitest";
import { nodeMachine } from "../../platforms/node/node-machine";
import { cloneRepository, createRemote, createRepository } from "../../testing/repository";
import { FileStore } from "../files/file-store";
import { Git } from "../git/git";
import { LocalHost } from "../hosts/local-host";
import { ContentStore } from "./content-store";

const host = new LocalHost(nodeMachine());
const SEED = ["docs", "tasks", ".gitdesk.yml"];

function storeFor(root: string) {
  const normalized = host.paths.normalize(root);
  return new ContentStore(host, new Git(host, normalized), new FileStore(host, normalized));
}

describe("ContentStore in the checkout", () => {
  it("uses the checkout and never commits", async () => {
    const repository = await createRepository();
    const store = storeFor(repository.root);
    const location = await store.locate();
    expect(location.branch).toBeNull();
    expect(location.root).toBe(host.paths.normalize(repository.root));
    expect(await store.branchState()).toBeNull();
    await location.files.write("docs/New.md", "x", null);
    await store.record(["docs/New.md"], "Edit");
    expect((await repository.git("status", "--porcelain")).trim()).toBe("?? docs/New.md");
    await expect(store.sync()).rejects.toThrow("stored in the checkout");
  });
});

describe("ContentStore history", () => {
  const task = (status: string) => `---\nid: TP-1\ntitle: T\nstatus: ${status}\n---\n\nText\n`;

  it("follows a file across moves, with both versions of every commit", async () => {
    const repository = await createRepository({ "tasks/TP-1.md": task("todo") });
    const move = async (from: string, to: string, content: string, message: string) => {
      await repository.write(to, content);
      await repository.git("rm", "-q", from);
      await repository.git("add", "-A");
      await repository.git("commit", "-q", "-m", message);
    };
    await move("tasks/TP-1.md", "tasks/Auth/TP-1.md", task("done"), "Move TP-1 to Auth");
    await move("tasks/Auth/TP-1.md", "tasks/Billing/TP-1.md", task("done"), "Move TP-1 to Billing");
    const store = storeFor(repository.root);
    const revisions = await store.history("tasks/Billing/TP-1.md", 100, true);
    expect(revisions.map((revision) => [revision.subject, revision.oldPath, revision.path, revision.author])).toEqual([
      ["Move TP-1 to Billing", "tasks/Auth/TP-1.md", "tasks/Billing/TP-1.md", "Test"],
      ["Move TP-1 to Auth", "tasks/TP-1.md", "tasks/Auth/TP-1.md", "Test"],
      ["Initial commit", null, "tasks/TP-1.md", "Test"],
    ]);
    expect(revisions[1]).toMatchObject({ before: task("todo"), after: task("done") });
    expect(revisions[2]).toMatchObject({ before: null, after: task("todo") });
    expect((await store.history("tasks/Billing/TP-1.md", 1, false)).map((revision) => [revision.oldPath, revision.after])).toEqual([
      ["tasks/Auth/TP-1.md", null],
    ]);
  });

  it("reads the committed version and committed files", async () => {
    const repository = await createRepository({ "tasks/TP-1.md": task("todo"), "tasks/A/TP-2.md": task("todo") });
    await repository.write("tasks/TP-1.md", task("done"));
    const store = storeFor(repository.root);
    expect(await store.committed("tasks/TP-1.md")).toBe(task("todo"));
    expect(await store.committed("tasks/TP-3.md")).toBeNull();
    expect((await store.committedFiles("tasks")).sort()).toEqual(["tasks/A/TP-2.md", "tasks/TP-1.md"]);
  });

  it("has no history before the first commit", async () => {
    const repository = await createRepository({ "tasks/TP-1.md": task("todo") }, false);
    const store = storeFor(repository.root);
    expect(await store.history("tasks/TP-1.md", 100, true)).toEqual([]);
    expect(await store.committed("tasks/TP-1.md")).toBeNull();
    expect(await store.committedFiles("tasks")).toEqual([]);
  });

  it("reads the history of the content branch when content lives there", async () => {
    const repository = await createRepository();
    const store = storeFor(repository.root);
    await store.setMode("branch", SEED);
    const location = await store.locate();
    await location.files.write("tasks/TP-1.md", task("todo"), null);
    await store.record(["tasks/TP-1.md"], "Create TP-1");
    const created = await location.files.read("tasks/TP-1.md");
    await location.files.write("tasks/TP-1.md", task("done"), created.hash);
    await store.record(["tasks/TP-1.md"], "Update TP-1");
    expect((await store.history("tasks/TP-1.md", 100, true)).map((revision) => revision.subject)).toEqual(["Update TP-1", "Create TP-1"]);
    expect(await store.committed("tasks/TP-1.md")).toBe(task("done"));
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

describe("ContentStore on a dedicated branch", () => {
  it("copies the committed content into a new branch worktree and commits every edit", async () => {
    const repository = await createRepository();
    const store = storeFor(repository.root);
    await store.setMode("branch", SEED);
    const location = await store.locate();
    expect(location.branch).toBe("gitdesk");
    expect(location.root).not.toBe(host.paths.normalize(repository.root));
    expect((await store.files()).sort()).toEqual([
      ".gitdesk.yml",
      "docs/Architecture.md",
      "docs/Architecture/Backend.md",
      "docs/Architecture/Backend/Auth.md",
      "docs/Home.md",
    ]);

    const home = await location.files.read("docs/Home.md");
    await location.files.write("docs/Home.md", "# Home\n\nShared.\n", home.hash);
    await store.record(["docs/Home.md"], "Edit docs/Home.md");
    expect((await repository.git("log", "--format=%s", "gitdesk")).trim().split("\n")).toEqual([
      "Edit docs/Home.md",
      "Copy wiki and tasks from the main checkout",
      "Start the GitDesk content branch",
    ]);
    expect((await repository.git("status", "--porcelain")).trim()).toBe("");
    expect(await store.branchState()).toMatchObject({ branch: "gitdesk", remote: null, uncommitted: 0 });
  });

  it("starts an empty branch in a repository without commits", async () => {
    const repository = await createRepository({ "docs/Home.md": "# Home\n" }, false);
    const store = storeFor(repository.root);
    await store.setMode("branch", SEED);
    expect(await store.files()).toEqual([]);
  });

  it("syncs through a remote, where another clone picks the branch up", async () => {
    const repository = await createRepository();
    const remote = await createRemote();
    await repository.git("remote", "add", "origin", remote);
    const store = storeFor(repository.root);
    await store.setMode("branch", SEED);
    await store.sync();
    expect(await store.branchState()).toMatchObject({ remote: "origin" });

    const clone = await cloneRepository(remote);
    const theirs = storeFor(clone.root);
    const location = await theirs.locate();
    expect(location.branch).toBe("gitdesk");
    const home = await location.files.read("docs/Home.md");
    await location.files.write("docs/Home.md", "# Home\n\nFrom the clone.\n", home.hash);
    await theirs.record(["docs/Home.md"], "Edit from clone");
    await theirs.sync();

    const mine = await store.locate();
    await mine.files.write("docs/New.md", "# New\n", null);
    await store.record(["docs/New.md"], "Add page");
    await store.sync();
    expect((await mine.files.read("docs/Home.md")).content.replace(/\r\n/g, "\n")).toBe("# Home\n\nFrom the clone.\n");
    expect(await store.branchState()).toMatchObject({ head: { ahead: 0, behind: 0 } });
  });

  it("reports conflicting edits and leaves no rebase behind", async () => {
    const repository = await createRepository();
    const remote = await createRemote();
    await repository.git("remote", "add", "origin", remote);
    const store = storeFor(repository.root);
    await store.setMode("branch", SEED);
    await store.sync();
    const clone = await cloneRepository(remote);
    const theirs = storeFor(clone.root);
    const edit = async (target: ContentStore, text: string) => {
      const location = await target.locate();
      const home = await location.files.read("docs/Home.md");
      await location.files.write("docs/Home.md", text, home.hash);
      await target.record(["docs/Home.md"], text);
    };
    await edit(theirs, "theirs\n");
    await theirs.sync();
    await edit(store, "mine\n");
    await expect(store.sync()).rejects.toThrow("conflict with origin/gitdesk");
    const location = await store.locate();
    expect(await location.git.attempt(["rev-parse", "--verify", "--quiet", "REBASE_HEAD"])).toBeNull();
  });

  it("remembers a failing auto-commit and commits the edit later", async () => {
    const repository = await createRepository();
    const store = storeFor(repository.root);
    await store.setMode("branch", SEED);
    await repository.git("config", "user.useConfigOnly", "true");
    await repository.git("config", "user.name", "");
    const location = await store.locate();
    const home = await location.files.read("docs/Home.md");
    await location.files.write("docs/Home.md", "offline\n", home.hash);
    await store.record(["docs/Home.md"], "Edit");
    expect(store.commitFailure).toBeTruthy();

    await repository.git("config", "user.name", "Test");
    await location.files.write("docs/New.md", "x", null);
    await store.record(["docs/New.md"], "Add");
    expect(store.commitFailure).toBeNull();
    expect(await repository.git("log", "--format=%s", "gitdesk")).toMatch(/Commit pending GitDesk edits/);
  });

  it("switches back to the checkout and leaves a consistent repository", async () => {
    const repository = await createRepository();
    const store = storeFor(repository.root);
    await store.setMode("branch", SEED);
    await store.setMode("worktree", SEED);
    expect((await store.locate()).branch).toBeNull();
    expect(await repository.git("fsck", "--no-progress")).not.toMatch(/missing/);
  });

  it("repairs the worktree after the repository moved", async () => {
    const repository = await createRepository();
    await storeFor(repository.root).setMode("branch", SEED);
    const moved = repository.root + "-moved";
    const { promises: fs } = await import("node:fs");
    await fs.rename(repository.root, moved);
    const { onTestFinished } = await import("vitest");
    onTestFinished(() => fs.rm(moved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => undefined));
    const location = await storeFor(moved).locate();
    expect(location.root.startsWith(host.paths.normalize(moved))).toBe(true);
    expect((await location.files.read("docs/Home.md")).content).toContain("# Home");
  });
});
