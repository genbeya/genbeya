import { describe, expect, it } from "vitest";
import { nodeMachine } from "../../platforms/node/node-machine";
import { createRemote, createRepository } from "../../testing/repository";
import { LocalHost } from "../hosts/local-host";
import { RepositoryAccess } from "./repository-access";

const host = new LocalHost(nodeMachine());
const open = async (path: string) => new RepositoryAccess(host, await RepositoryAccess.locate(host, path));

async function withFeature() {
  const repository = await createRepository();
  const repo = await open(repository.root);
  await repo.createBranch("feature", undefined, true);
  await repository.write("feature.md", "feature");
  await repository.git("add", ".");
  await repository.git("commit", "-q", "-m", "Feature");
  await repo.switchBranch("main");
  return { repository, repo };
}

describe("RefAccess", () => {
  it("creates branches at a start point, with or without switching", async () => {
    const { repository, repo } = await withFeature();
    const feature = (await repository.git("rev-parse", "feature")).trim();
    await repo.createBranch("kept", feature, false);
    expect((await repo.head()).branch).toBe("main");
    expect((await repository.git("rev-parse", "kept")).trim()).toBe(feature);
    await repo.createBranch("taken", "feature", true);
    expect((await repo.head()).branch).toBe("taken");
  });

  it("lists branches, remote branches and tags", async () => {
    const { repo } = await withFeature();
    await repo.refs.createTag("v1.0", "main", "");
    const remote = await createRemote();
    await repo.setRemote("origin", remote);
    await repo.sync("push", "origin", "main");
    expect(await repo.refs.names()).toEqual({ branches: ["feature", "main"], remoteBranches: ["origin/main"], tags: ["v1.0"] });
    expect((await repo.state()).tags).toEqual(["v1.0"]);
  });

  it("renames branches and deletes them, refusing unmerged ones unless forced", async () => {
    const { repository, repo } = await withFeature();
    await repo.refs.renameBranch("feature", "feature/renamed");
    expect((await repo.refs.names()).branches).toEqual(["feature/renamed", "main"]);
    expect(await repo.refs.deleteBranch("feature/renamed", false)).toBe(false);
    expect((await repo.refs.names()).branches).toContain("feature/renamed");
    expect(await repo.refs.deleteBranch("feature/renamed", true)).toBe(true);
    expect((await repo.refs.names()).branches).toEqual(["main"]);
    await expect(repo.refs.deleteBranch("main", true)).rejects.toThrow(/main/);
    expect(await repository.git("branch", "--list")).toContain("main");
  });

  it("creates lightweight and annotated tags and deletes them", async () => {
    const { repository, repo } = await withFeature();
    await repo.refs.createTag("light", "feature", "");
    await repo.refs.createTag("annotated", "main", "Release notes");
    expect((await repository.git("cat-file", "-t", "light")).trim()).toBe("commit");
    expect((await repository.git("cat-file", "-t", "annotated")).trim()).toBe("tag");
    expect(await repository.git("tag", "-l", "-n1", "annotated")).toContain("Release notes");
    expect(await repo.refs.isValidTagName("v1.0")).toBe(true);
    expect(await repo.refs.isValidTagName("bad..tag")).toBe(false);
    await repo.refs.deleteTag("light");
    expect((await repo.refs.names()).tags).toEqual(["annotated"]);
  });

  it("pushes and deletes tags and branches on a remote, and sets upstreams", async () => {
    const { repository, repo } = await withFeature();
    const remote = await createRemote();
    await repo.setRemote("origin", remote);
    await repo.sync("push", "origin", "main");
    await repository.git("push", "-q", "origin", "feature");
    await repo.refs.createTag("v1", "main", "");
    await repo.refs.pushTag("v1", "origin");
    expect(await repository.git("ls-remote", "--tags", "origin")).toContain("refs/tags/v1");
    await repo.refs.deleteRemoteTag("v1", "origin");
    expect(await repository.git("ls-remote", "--tags", "origin")).not.toContain("refs/tags/v1");

    await repo.refs.setUpstream("feature", "origin/feature");
    expect((await repository.git("rev-parse", "--abbrev-ref", "feature@{upstream}")).trim()).toBe("origin/feature");
    await repo.refs.deleteRemoteBranch("origin", "feature");
    expect(await repository.git("ls-remote", "--heads", "origin")).not.toContain("refs/heads/feature");
    expect((await repo.refs.names()).remoteBranches).toEqual(["origin/main"]);
  });
});
