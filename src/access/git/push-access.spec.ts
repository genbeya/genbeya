import { describe, expect, it } from "vitest";
import { nodeMachine } from "../../platforms/node/node-machine";
import { cloneRepository, createRemote, createRepository, type TestRepository } from "../../testing/repository";
import { LocalHost } from "../hosts/local-host";
import { RepositoryAccess } from "./repository-access";

const host = new LocalHost(nodeMachine());

/** A repository whose main is pushed to the bare `origin`, which a second clone also uses. */
async function published() {
  const repository = await createRepository();
  const remote = await createRemote();
  await repository.git("remote", "add", "origin", remote);
  await repository.git("push", "-q", "--set-upstream", "origin", "main");
  const access = new RepositoryAccess(host, await RepositoryAccess.locate(host, repository.root));
  const remoteHead = async (branch: string) => (await repository.git("ls-remote", "origin", `refs/heads/${branch}`)).split("\t")[0];
  return { repository, remote, access, remoteHead };
}

async function commit(repository: TestRepository, name: string): Promise<string> {
  await repository.write(`${name}.txt`, name);
  await repository.git("add", ".");
  await repository.git("commit", "-q", "-m", name);
  return (await repository.git("rev-parse", "HEAD")).trim();
}

const config = (repository: TestRepository, key: string) =>
  repository.git("config", "--get", key).then(
    (value) => value.trim(),
    () => null,
  );

describe("PushAccess", () => {
  it("plans where a branch can go: its upstream, and each remote's branches and default branch", async () => {
    const { repository, remote, access } = await published();
    await repository.git("switch", "-q", "--create", "feature");
    await repository.git("push", "-q", "origin", "feature");
    expect(await access.pushes.plan("main")).toEqual({
      branch: "main",
      upstream: { remote: "origin", branch: "main" },
      // The remote was added, not cloned, so the remote names its default branch when asked.
      remotes: [{ remote: "origin", defaultBranch: "main", branches: ["feature", "main"] }],
    });
    expect((await access.pushes.plan("feature")).upstream).toBeNull();

    const clone = await cloneRepository(remote);
    const theirs = new RepositoryAccess(host, await RepositoryAccess.locate(host, clone.root));
    await clone.git("remote", "add", "unreachable", `${remote}-missing`);
    expect((await theirs.pushes.plan("main")).remotes).toEqual([
      { remote: "origin", defaultBranch: "main", branches: ["feature", "main"] },
      { remote: "unreachable", defaultBranch: null, branches: [] },
    ]);
  });

  it("publishes a branch and makes the remote branch its upstream", async () => {
    const { repository, access, remoteHead } = await published();
    await repository.git("switch", "-q", "--create", "feature");
    const tip = await commit(repository, "Feature");
    expect(await access.pushes.push({ branch: "feature", remote: "origin", remoteBranch: "feature", setUpstream: true })).toBe("done");
    expect(await remoteHead("feature")).toBe(tip);
    expect(await access.head()).toMatchObject({ branch: "feature", upstream: "origin/feature", ahead: 0 });
  });

  it("pushes a branch to a branch of another name, setting the upstream only when asked", async () => {
    const { repository, access, remoteHead } = await published();
    await repository.git("switch", "-q", "--create", "feature");
    const one = await commit(repository, "One");
    await access.pushes.push({ branch: "feature", remote: "origin", remoteBranch: "main", setUpstream: false });
    expect(await remoteHead("main")).toBe(one);
    expect(await config(repository, "branch.feature.merge")).toBeNull();

    // Another branch than the checked-out one.
    await repository.git("switch", "-q", "main");
    await repository.git("switch", "-q", "--create", "other");
    await repository.git("switch", "-q", "main");
    await access.pushes.push({ branch: "feature", remote: "origin", remoteBranch: "release", setUpstream: true });
    expect(await config(repository, "branch.feature.remote")).toBe("origin");
    expect(await config(repository, "branch.feature.merge")).toBe("refs/heads/release");
    expect(await remoteHead("release")).toBe(one);
  });

  it("reports a push the remote rejects for commits the branch lacks", async () => {
    const { repository, remote, access, remoteHead } = await published();
    const clone = await cloneRepository(remote);
    const theirs = await commit(clone, "Theirs");
    await clone.git("push", "-q", "origin", "main");
    await commit(repository, "Mine");
    expect(await access.pushes.push({ branch: "main", remote: "origin", remoteBranch: "main", setUpstream: false })).toBe("rejected");
    expect(await remoteHead("main")).toBe(theirs);
  });

  it("lists what a force push removes, and replaces the remote branch while the lease holds", async () => {
    const { repository, access, remoteHead } = await published();
    const pushed = await commit(repository, "Pushed");
    await repository.git("push", "-q", "origin", "main");
    await repository.git("commit", "-q", "--amend", "-m", "Amended");
    const amended = (await repository.git("rev-parse", "HEAD")).trim();
    expect(await access.pushes.push({ branch: "main", remote: "origin", remoteBranch: "main", setUpstream: false })).toBe("rejected");

    const plan = await access.pushes.forcePlan("main", "origin", "main");
    expect(plan).toMatchObject({ expected: pushed, total: 1, defaultBranch: true });
    expect(plan.removed.map((entry) => entry.subject)).toEqual(["Pushed"]);
    const forced = {
      branch: "main",
      remote: "origin",
      remoteBranch: "main",
      setUpstream: false,
      force: { expected: pushed, defaultBranch: true },
    };
    expect(await access.pushes.push(forced)).toBe("done");
    expect(await remoteHead("main")).toBe(amended);
  });

  it("refuses a force push once the remote branch moved since the commit the user reviewed", async () => {
    const { repository, remote, access, remoteHead } = await published();
    const reviewed = (await repository.git("rev-parse", "origin/main")).trim();
    const clone = await cloneRepository(remote);
    const theirs = await commit(clone, "Theirs");
    await clone.git("push", "-q", "origin", "main");
    await commit(repository, "Mine");
    // A fetch meanwhile moves the remote-tracking branch; the lease still expects what the user reviewed.
    await repository.git("fetch", "-q", "origin");
    const forced = {
      branch: "main",
      remote: "origin",
      remoteBranch: "main",
      setUpstream: false,
      force: { expected: reviewed, defaultBranch: true },
    };
    await expect(access.pushes.push(forced)).rejects.toThrow("origin/main changed since your last fetch. Fetch and review it first.");
    expect(await remoteHead("main")).toBe(theirs);

    // A branch the last fetch did not see must still not exist.
    await clone.git("push", "-q", "origin", "main:refs/heads/new");
    await expect(access.pushes.push({ ...forced, remoteBranch: "new", force: { expected: null, defaultBranch: false } })).rejects.toThrow(
      "origin/new changed since your last fetch",
    );
  });

  it("plans a force push to a branch the last fetch did not see as removing nothing", async () => {
    const { access } = await published();
    expect(await access.pushes.forcePlan("main", "origin", "elsewhere")).toEqual({
      expected: null,
      removed: [],
      total: 0,
      defaultBranch: false,
    });
  });
});
