/** Resetting and pushing through the RPC transport, as a shell calls them; the rest of the manager is in backend.spec.ts. */
import { describe, expect, it } from "vitest";
import type { PushRequest } from "../contracts/model";
import { connectManagers, dispatch } from "../contracts/rpc";
import { nodeMachine } from "../platforms/node/node-machine";
import { cloneRepository, createRemote, createRepository, onTestFinished, type TestRepository } from "../testing/repository";
import { temporaryFolder } from "../testing/temp";
import { createBackend } from "./backend";

async function opened() {
  const repository = await createRepository();
  const managers = await createBackend(nodeMachine(), await temporaryFolder("data-"));
  onTestFinished(() => managers.dispose());
  const { workspace, versionControl } = connectManagers((request) => dispatch(managers, structuredClone(request)));
  const { id } = await workspace.open({ kind: "local", path: repository.root });
  const latest = async () => (await workspace.snapshot(id))!;
  const head = async () => (await repository.git("rev-parse", "HEAD")).trim();
  return { repository, versionControl, id, latest, head };
}

async function commit(repository: TestRepository, name: string): Promise<string> {
  await repository.write(`${name}.txt`, name);
  await repository.git("add", ".");
  await repository.git("commit", "-q", "-m", name);
  return (await repository.git("rev-parse", "HEAD")).trim();
}

/** `opened`, with main pushed to a bare origin that it tracks. */
async function publishedRepository() {
  const opening = await opened();
  const remote = await createRemote();
  await opening.repository.git("remote", "add", "origin", remote);
  await opening.repository.git("push", "-q", "--set-upstream", "origin", "main");
  const remoteHead = async (branch: string) =>
    (await opening.repository.git("ls-remote", "origin", `refs/heads/${branch}`)).split("\t")[0] || null;
  return { ...opening, remote, remoteHead };
}

describe("VersionControlManager resets", () => {
  it("resets the branch with each mode and undoes it", async () => {
    const { repository, versionControl, id, latest, head } = await opened();
    const initial = await head();
    const one = await commit(repository, "One");
    await repository.write("docs/Home.md", "edited");

    const plan = await versionControl.resetPlan(id, initial);
    expect(plan).toMatchObject({ branch: "main", head: one, target: initial, commits: 1, pushed: 0, uncommitted: ["docs/Home.md"] });
    expect(await versionControl.reset(id, initial, "mixed", plan.head)).toEqual({ from: one, to: initial });
    expect((await latest()).changes.map((change) => [change.path, change.index])).toEqual([
      ["docs/Home.md", " "],
      ["One.txt", "?"],
    ]);
    await versionControl.reset(id, one, "mixed", initial);
    expect(await head()).toBe(one);

    await versionControl.reset(id, initial, "soft", one);
    expect((await latest()).changes.find((change) => change.path === "One.txt")?.index).toBe("A");
    await versionControl.reset(id, one, "soft", initial);

    await versionControl.reset(id, initial, "hard", one);
    expect(await repository.read("docs/Home.md")).toBe("# Home\n");
    expect(await repository.exists("One.txt")).toBe(false);
    await versionControl.reset(id, one, "keep", initial);
    expect(await repository.read("One.txt")).toBe("One");
  });

  it("refuses a reset once the branch moved since it was planned", async () => {
    const { repository, versionControl, id, head } = await opened();
    const initial = await head();
    const planned = (await versionControl.resetPlan(id, initial)).head;
    const moved = await commit(repository, "Meanwhile");
    await expect(versionControl.reset(id, initial, "hard", planned)).rejects.toThrow("main moved since");
    expect(await head()).toBe(moved);
  });

  it("refuses to reset while a merge is in progress", async () => {
    const { repository, versionControl, id, head } = await opened();
    const initial = await head();
    await repository.git("switch", "-q", "-c", "feature");
    await repository.write("src/code.ts", "feature\n");
    await repository.git("commit", "-qam", "Feature");
    await repository.git("switch", "-q", "main");
    await repository.write("src/code.ts", "main\n");
    await repository.git("commit", "-qam", "Main");
    expect(await versionControl.merge(id, "feature", { noFastForward: false, message: "" })).toBe("stopped");
    await expect(versionControl.resetPlan(id, initial)).rejects.toThrow("Finish or abort the merge first.");
    await expect(versionControl.reset(id, initial, "hard", await head())).rejects.toThrow("Finish or abort the merge first.");
    await expect(versionControl.undoLastCommit(id)).rejects.toThrow("Finish or abort the merge first.");
  });

  it("undoes the last commit, keeping its changes staged", async () => {
    const { repository, versionControl, id, latest, head } = await opened();
    const initial = await head();
    const one = await commit(repository, "One");
    expect(await versionControl.undoLastCommit(id)).toEqual({ from: one, to: initial });
    expect((await latest()).changes).toEqual([expect.objectContaining({ path: "One.txt", index: "A" })]);
    await expect(versionControl.undoLastCommit(id)).rejects.toThrow("The last commit is the first one");
  });

  it("rejects invalid modes and commits, and resets without a branch", async () => {
    const { repository, versionControl, id, head } = await opened();
    const hash = await head();
    await expect(versionControl.reset(id, hash, "--hard" as never, hash)).rejects.toThrow("Invalid reset mode.");
    await expect(versionControl.reset(id, hash, "merge" as never, hash)).rejects.toThrow("Invalid reset mode.");
    await expect(versionControl.reset(id, "HEAD~1", "soft", hash)).rejects.toThrow("Choose a commit.");
    await expect(versionControl.reset(id, "--hard", "soft", hash)).rejects.toThrow("Choose a commit.");
    await expect(versionControl.resetPlan(id, "a".repeat(40))).rejects.toThrow("Choose a commit.");
    await expect(versionControl.reset(id, hash, "soft", "HEAD")).rejects.toThrow("Invalid commit ID.");
    await repository.git("switch", "-q", "--detach");
    await expect(versionControl.reset(id, hash, "soft", hash)).rejects.toThrow("Switch to a branch first.");
    await expect(versionControl.undoLastCommit(id)).rejects.toThrow("Switch to a branch first.");
  });
});

describe("VersionControlManager pushes", () => {
  it("publishes a branch, setting its upstream", async () => {
    const { repository, versionControl, id, latest, remoteHead } = await publishedRepository();
    await versionControl.createBranch(id, "feature");
    const tip = await commit(repository, "Feature");
    expect((await versionControl.pushPlan(id, "feature")).upstream).toBeNull();
    const request = { branch: "feature", remote: "origin", remoteBranch: "feature", setUpstream: true };
    expect(await versionControl.push(id, request)).toBe("done");
    expect(await remoteHead("feature")).toBe(tip);
    expect((await latest()).head).toMatchObject({ branch: "feature", upstream: "origin/feature", ahead: 0 });
  });

  it("pushes feature to the remote's main, with and without making it the upstream", async () => {
    const { repository, versionControl, id, remoteHead } = await publishedRepository();
    await versionControl.createBranch(id, "feature");
    const one = await commit(repository, "One");
    await versionControl.push(id, { branch: "feature", remote: "origin", remoteBranch: "main", setUpstream: false });
    expect(await remoteHead("main")).toBe(one);
    expect((await versionControl.pushPlan(id, "feature")).upstream).toBeNull();
    const two = await commit(repository, "Two");
    await versionControl.push(id, { branch: "feature", remote: "origin", remoteBranch: "main", setUpstream: true });
    expect(await remoteHead("main")).toBe(two);
    expect((await versionControl.pushPlan(id, "feature")).upstream).toEqual({ remote: "origin", branch: "main" });
  });

  it("force pushes an amended commit with a lease, but to the default branch only when told", async () => {
    const { repository, versionControl, id, head, remoteHead } = await publishedRepository();
    const pushed = await commit(repository, "Pushed");
    await repository.git("push", "-q");
    await repository.git("commit", "-q", "--amend", "-m", "Amended");
    const main: PushRequest = { branch: "main", remote: "origin", remoteBranch: "main", setUpstream: false };
    expect(await versionControl.push(id, main)).toBe("rejected");

    const plan = await versionControl.forcePushPlan(id, "main", "origin", "main");
    expect(plan).toMatchObject({ expected: pushed, total: 1, defaultBranch: true });
    await expect(versionControl.push(id, { ...main, force: { expected: pushed, defaultBranch: false } })).rejects.toThrow(
      "main is the default branch of origin",
    );
    expect(await remoteHead("main")).toBe(pushed);
    expect(await versionControl.push(id, { ...main, force: { expected: pushed, defaultBranch: true } })).toBe("done");
    expect(await remoteHead("main")).toBe(await head());
  });

  it("fails a force push when the remote moved after the last fetch", async () => {
    const { repository, remote, versionControl, id, remoteHead } = await publishedRepository();
    await versionControl.createBranch(id, "feature");
    await commit(repository, "Mine");
    await versionControl.push(id, { branch: "feature", remote: "origin", remoteBranch: "feature", setUpstream: true });
    const { expected } = await versionControl.forcePushPlan(id, "feature", "origin", "feature");
    const clone = await cloneRepository(remote);
    await clone.git("switch", "-q", "feature");
    const theirs = await commit(clone, "Theirs");
    await clone.git("push", "-q", "origin", "feature");
    await repository.git("commit", "-q", "--amend", "-m", "Mine, amended");
    const force = { expected, defaultBranch: false };
    await expect(
      versionControl.push(id, { branch: "feature", remote: "origin", remoteBranch: "feature", setUpstream: false, force }),
    ).rejects.toThrow("origin/feature changed since your last fetch. Fetch and review it first.");
    expect(await remoteHead("feature")).toBe(theirs);
  });

  it("refuses names that look like options and requests it cannot read", async () => {
    const { repository, versionControl, id } = await publishedRepository();
    await repository.git("branch", "--end-of-options", "feature/-f");
    const push = (change: Partial<PushRequest>) =>
      versionControl.push(id, { branch: "main", remote: "origin", remoteBranch: "main", setUpstream: false, ...change });
    await expect(push({ branch: "feature/-f" })).rejects.toThrow("looks like an option");
    await expect(push({ remoteBranch: "-f" })).rejects.toThrow("Invalid branch name.");
    await expect(push({ remoteBranch: "x/-f" })).rejects.toThrow("looks like an option");
    await expect(push({ remoteBranch: "HEAD" })).rejects.toThrow("Invalid branch name.");
    await expect(push({ remoteBranch: "bad..name" })).rejects.toThrow("not a valid branch name");
    await expect(push({ remote: "--upload-pack=x" })).rejects.toThrow("Choose a configured remote.");
    await expect(push({ branch: "missing" })).rejects.toThrow("Choose a branch.");
    await expect(push({ setUpstream: "yes" as never })).rejects.toThrow("Invalid push.");
    await expect(push({ force: { expected: "origin/main", defaultBranch: true } })).rejects.toThrow("Invalid push.");
    await expect(push({ force: true as never })).rejects.toThrow("Invalid push.");
    await expect(versionControl.pushPlan(id, "--all")).rejects.toThrow("Choose a branch.");
    await expect(versionControl.forcePushPlan(id, "main", "origin", "-x")).rejects.toThrow("Invalid branch name.");
  });
});
