import { describe, expect, it } from "vitest";
import { nodeMachine } from "../../platforms/node/node-machine";
import { createRemote, createRepository, type TestRepository } from "../../testing/repository";
import { LocalHost } from "../hosts/local-host";
import { RepositoryAccess } from "./repository-access";

const host = new LocalHost(nodeMachine());

/** A repository with commits One and Two after the initial one, each adding a file and changing src/code.ts. */
async function withCommits() {
  const repository = await createRepository();
  const commit = async (name: string) => {
    await repository.write(`${name}.txt`, name);
    await repository.write("src/code.ts", `export const value = "${name}";\n`);
    await repository.git("add", ".");
    await repository.git("commit", "-q", "-m", name);
    return (await repository.git("rev-parse", "HEAD")).trim();
  };
  const initial = (await repository.git("rev-parse", "HEAD")).trim();
  const one = await commit("One");
  const two = await commit("Two");
  const access = new RepositoryAccess(host, await RepositoryAccess.locate(host, repository.root));
  return { repository, access, initial, one, two, status: () => repository.git("status", "--porcelain") };
}

const head = (repository: TestRepository) => repository.git("rev-parse", "HEAD").then((hash) => hash.trim());

describe("ResetAccess", () => {
  it("plans a reset: the commits it leaves, which of them were pushed, and the changes a hard reset loses", async () => {
    const { repository, access, initial, one, two } = await withCommits();
    await repository.git("remote", "add", "origin", await createRemote());
    await repository.git("push", "-q", "origin", `${one}:refs/heads/main`);
    await repository.git("branch", "--set-upstream-to=origin/main");
    await repository.write("src/code.ts", "edited");
    await repository.write("untracked.txt", "kept");

    expect(await access.resets.plan(initial)).toEqual({
      branch: "main",
      head: two,
      target: initial,
      commits: 2,
      upstream: "origin/main",
      pushed: 1,
      uncommitted: ["src/code.ts"],
    });
    expect(await access.resets.plan(two)).toMatchObject({ commits: 0, pushed: 0 });
  });

  it("refuses to plan without a branch or a commit", async () => {
    const { repository, access, one } = await withCommits();
    await repository.git("switch", "-q", "--detach", one);
    await expect(access.resets.plan(one)).rejects.toThrow("Switch to a branch first.");
    const empty = await createRepository({}, false);
    const unborn = new RepositoryAccess(host, await RepositoryAccess.locate(host, empty.root));
    await expect(unborn.resets.plan(one)).rejects.toThrow();
  });

  it("keeps the changes staged with soft, unstaged with mixed, and moves back", async () => {
    const { repository, access, initial, two, status } = await withCommits();
    expect(await access.resets.reset(initial, "soft")).toEqual({ from: two, to: initial });
    expect(await head(repository)).toBe(initial);
    expect(await status()).toBe("A  One.txt\nA  Two.txt\nM  src/code.ts\n");

    await access.resets.reset(two, "soft");
    expect(await status()).toBe("");

    await access.resets.reset(initial, "mixed");
    expect(await status()).toBe(" M src/code.ts\n?? One.txt\n?? Two.txt\n");
    expect(await repository.read("src/code.ts")).toBe('export const value = "Two";\n');
    await access.resets.reset(two, "mixed");
    expect(await status()).toBe("");
  });

  it("discards everything with hard, and moves back with keep", async () => {
    const { repository, access, one, two, status } = await withCommits();
    await repository.write("docs/Home.md", "lost");
    await access.resets.reset(one, "hard");
    expect(await status()).toBe("");
    expect(await repository.read("src/code.ts")).toBe('export const value = "One";\n');
    expect(await repository.read("docs/Home.md")).toBe("# Home\n");
    expect(await repository.exists("Two.txt")).toBe(false);

    await access.resets.reset(two, "keep");
    expect(await head(repository)).toBe(two);
    expect(await repository.read("src/code.ts")).toBe('export const value = "Two";\n');
  });

  it("keeps uncommitted changes with keep, and refuses when it would overwrite them", async () => {
    const { repository, access, initial, one } = await withCommits();
    await repository.write("docs/Home.md", "mine");
    await access.resets.reset(one, "keep");
    expect(await repository.read("docs/Home.md")).toBe("mine");

    await repository.write("src/code.ts", "mine too");
    await expect(access.resets.reset(initial, "keep")).rejects.toThrow(
      "Keep would overwrite your uncommitted changes to src/code.ts. Commit or stash them, or choose another mode.",
    );
    expect(await head(repository)).toBe(one);
    expect(await repository.read("src/code.ts")).toBe("mine too");
  });

  it("names the commit before the last one to undo it, but not for the first commit or a merge", async () => {
    const { repository, access, one } = await withCommits();
    expect(await access.resets.parentOfHead()).toBe(one);

    await repository.git("switch", "-q", "--create", "side", one);
    await repository.write("side.txt", "side");
    await repository.git("add", ".");
    await repository.git("commit", "-q", "-m", "Side");
    await repository.git("switch", "-q", "main");
    await repository.git("merge", "-q", "--no-ff", "-m", "Merge side", "side");
    await expect(access.resets.parentOfHead()).rejects.toThrow("The last commit is a merge");

    const single = await createRepository();
    const first = new RepositoryAccess(host, await RepositoryAccess.locate(host, single.root));
    await expect(first.resets.parentOfHead()).rejects.toThrow("The last commit is the first one");
  });
});
