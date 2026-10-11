import { describe, expect, it } from "vitest";
import { nodeMachine } from "../../platforms/node/node-machine";
import { createRepository } from "../../testing/repository";
import { LocalHost } from "../hosts/local-host";
import { RepositoryAccess } from "./repository-access";

const host = new LocalHost(nodeMachine());
const open = async (path: string) => new RepositoryAccess(host, await RepositoryAccess.locate(host, path));
const options = { message: "", includeUntracked: false, keepIndex: false };

describe("StashAccess", () => {
  it("stashes changes with a message and lists them, newest first", async () => {
    const repository = await createRepository();
    const repo = await open(repository.root);
    await repository.write("src/code.ts", "first");
    await repo.stashes.push({ ...options, message: "First try" });
    expect(await repository.read("src/code.ts")).toBe("export const value = 1;\n");
    await repository.write("src/code.ts", "second");
    await repo.stashes.push(options);

    const [latest, first] = await repo.stashes.list();
    expect(first).toMatchObject({ index: 1, branch: "main", message: "First try" });
    expect(latest).toMatchObject({ index: 0, branch: "main", message: expect.stringContaining("Initial commit") });
    expect(latest!.hash).toMatch(/^[a-f0-9]{40}$/);
    expect((await repo.state()).stashes).toHaveLength(2);
    // Stash commits stay out of the history.
    expect((await repo.log(0, 10)).map((commit) => commit.subject)).toEqual(["Initial commit"]);
  });

  it("includes untracked files on request and keeps the index on request", async () => {
    const repository = await createRepository();
    const repo = await open(repository.root);
    await repository.write("new.txt", "new");
    await repository.write("src/code.ts", "staged");
    await repo.stage(["src/code.ts"]);
    await repo.stashes.push({ message: "All", includeUntracked: true, keepIndex: true });
    expect(await repository.exists("new.txt")).toBe(false);
    expect(await repo.changes()).toEqual([{ path: "src/code.ts", index: "M", worktree: " " }]);

    const stash = (await repo.stashes.list())[0]!;
    const { files } = await repo.stashes.detail(stash);
    expect(files.map(({ status, path }) => ({ status, path }))).toEqual([
      { status: "M", path: "src/code.ts" },
      { status: "A", path: "new.txt" },
    ]);
    expect(files[0]!.commit).toBe(stash.hash);
    expect(files[1]!.commit).not.toBe(stash.hash);
    // Each file diffs against its own commit.
    const [, untracked] = (await repo.diffSides("new.txt", { commit: files[1]!.commit }, "new.txt", 1000))!;
    expect(new TextDecoder().decode(untracked)).toBe("new");
  });

  it("applies, pops, drops and branches from stashes", async () => {
    const repository = await createRepository();
    const repo = await open(repository.root);
    await repository.write("src/code.ts", "changed");
    await repo.stashes.push(options);
    let [stash] = await repo.stashes.list();
    expect(await repo.stashes.apply(stash!, false)).toBe("done");
    expect(await repository.read("src/code.ts")).toBe("changed");
    expect(await repo.stashes.list()).toHaveLength(1);

    await repository.git("checkout", "--", "src/code.ts");
    expect(await repo.stashes.apply(stash!, true)).toBe("done");
    expect(await repository.read("src/code.ts")).toBe("changed");
    expect(await repo.stashes.list()).toEqual([]);

    await repo.stashes.push(options);
    [stash] = await repo.stashes.list();
    await repo.stashes.branch(stash!, "from-stash");
    expect(await repo.head()).toMatchObject({ branch: "from-stash" });
    expect(await repository.read("src/code.ts")).toBe("changed");

    await repo.stashes.push(options);
    await repo.stashes.drop((await repo.stashes.list())[0]!);
    expect(await repo.stashes.list()).toEqual([]);
  });

  it("addresses stashes by commit, though a terminal pushed another meanwhile", async () => {
    const repository = await createRepository();
    const repo = await open(repository.root);
    await repository.write("src/code.ts", "listed");
    await repo.stashes.push({ ...options, message: "Listed" });
    const [listed] = await repo.stashes.list();
    const pushed = async (content: string) => {
      await repository.write("src/code.ts", content);
      await repository.git("stash", "push", "-q", "-m", content);
    };

    await pushed("pushed meanwhile");
    expect(await repo.stashes.apply(listed!, false)).toBe("done");
    expect(await repository.read("src/code.ts")).toBe("listed");
    await repository.git("checkout", "--", "src/code.ts");

    await pushed("pushed again");
    expect(await repo.stashes.apply(listed!, true)).toBe("done");
    expect(await repository.read("src/code.ts")).toBe("listed");
    expect((await repo.stashes.list()).map((stash) => stash.message)).toEqual(["pushed again", "pushed meanwhile"]);
    await repository.git("checkout", "--", "src/code.ts");

    await repository.write("src/code.ts", "dropped");
    await repo.stashes.push({ ...options, message: "Dropped" });
    await repository.write("src/code.ts", "branched");
    await repo.stashes.push({ ...options, message: "Branched" });
    const [branched, dropped] = await repo.stashes.list();
    await pushed("pushed last");
    await repo.stashes.drop(dropped!);
    await repo.stashes.branch(branched!, "from-stash");
    expect(await repository.read("src/code.ts")).toBe("branched");
    expect((await repo.stashes.list()).map((stash) => stash.message)).toEqual(["pushed last", "pushed again", "pushed meanwhile"]);
    await expect(repo.stashes.drop(dropped!)).rejects.toThrow("This stash no longer exists.");
  });

  it("stops with conflicts and keeps a popped stash", async () => {
    const repository = await createRepository();
    const repo = await open(repository.root);
    await repository.write("src/code.ts", "stashed");
    await repo.stashes.push(options);
    await repository.write("src/code.ts", "committed");
    await repository.git("commit", "-qam", "Change");
    const [stash] = await repo.stashes.list();
    expect(await repo.stashes.apply(stash!, true)).toBe("stopped");
    expect(await repo.operations.conflicted()).toBe(true);
    expect((await repo.changes())[0]).toMatchObject({ path: "src/code.ts", conflict: "both-modified" });
    expect(await repo.stashes.list()).toHaveLength(1);
  });

  it("reports stashes that are gone and failures that are not conflicts", async () => {
    const repository = await createRepository();
    const repo = await open(repository.root);
    await expect(repo.stashes.find("a".repeat(40))).rejects.toThrow("This stash no longer exists.");
    await repository.write("new.txt", "stashed");
    await repo.stashes.push({ ...options, includeUntracked: true });
    await repository.write("new.txt", "in the way");
    await expect(repo.stashes.apply((await repo.stashes.list())[0]!, false)).rejects.toThrow(/already exists/);
  });
});
