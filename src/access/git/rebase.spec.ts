import { describe, expect, it, onTestFinished } from "vitest";
import type { RebaseTodo } from "../../contracts/rebase-todo";
import { nodeMachine } from "../../platforms/node/node-machine";
import { createRemote, createRepository } from "../../testing/repository";
import { decodeLenient } from "../../utilities/bytes";
import type { Host } from "../hosts/host";
import { HostFactory } from "../hosts/host-factory";
import { LocalHost } from "../hosts/local-host";
import { RepositoryAccess } from "./repository-access";

const machine = nodeMachine();

interface Fixture {
  readonly repo: RepositoryAccess;
  readonly host: Host;
  /** Runs git in the repository on its host. */
  git(...args: string[]): Promise<string>;
  /** Commits a file with `content` and `message`; resolves to the commit ID. */
  commit(file: string, content: string, message: string): Promise<string>;
}

async function fixture(host: Host, root: string): Promise<Fixture> {
  const git = async (...args: string[]) => {
    const result = await host.run("git", args, { cwd: root });
    if (result.code) throw new Error(result.stderr);
    return decodeLenient(result.stdout);
  };
  const repo = new RepositoryAccess(host, root);
  return {
    repo,
    host,
    git,
    async commit(file, content, message) {
      await host.write(root, file, new TextEncoder().encode(content), false);
      await git("add", "--", file);
      await git("commit", "-q", "-m", message);
      return (await git("rev-parse", "HEAD")).trim();
    },
  };
}

const subjects = async ({ git }: Fixture, range: string) => (await git("log", "--reverse", "--format=%s", range)).trim().split("\n");
const pick = (hash: string) => ({ command: "pick", hash }) as const;
/** True while the todo list and messages GitDesk prepared are still in the git directory. */
const prepared = async ({ repo, host }: Fixture) => (await host.kind(await repo.operations.gitDir(), "gitdesk-rebase")) !== null;

function describeInteractiveRebase(name: string, setup: () => Promise<Fixture>) {
  describe(`interactive rebase (${name})`, () => {
    it("reorders, rewords, squashes and drops commits without an editor", async () => {
      const it = await setup();
      const base = (await it.git("rev-parse", "HEAD")).trim();
      const one = await it.commit("one.txt", "1\n", "One");
      const two = await it.commit("two.txt", "2\n", "Two");
      const three = await it.commit("three.txt", "3\n", "Three");
      const four = await it.commit("four.txt", "4\n", "Four");
      const todo: RebaseTodo = {
        lines: [pick(two), pick(one), { command: "fixup", hash: three }, { command: "amend", message: 0 }, { command: "drop", hash: four }],
        messages: ["One and three\n\nWith 'quotes' and $dollars"],
      };
      expect(await it.repo.operations.rebaseInteractive(base, todo, false)).toBe("done");
      expect(await subjects(it, `${base}..HEAD`)).toEqual(["Two", "One and three"]);
      expect(await it.git("log", "-1", "--format=%B")).toContain("With 'quotes' and $dollars");
      expect((await it.git("ls-files")).split("\n")).toEqual(expect.arrayContaining(["one.txt", "two.txt", "three.txt"]));
      expect(await it.git("ls-files", "four.txt")).toBe("");
      expect(await it.repo.operations.current("main")).toBeNull();
    });

    it("stops for conflicts, then continues with the remaining steps", async () => {
      const it = await setup();
      const base = (await it.git("rev-parse", "HEAD")).trim();
      const first = await it.commit("same.txt", "first\n", "First");
      const second = await it.commit("same.txt", "second\n", "Second");
      const todo: RebaseTodo = { lines: [pick(second), pick(first), { command: "amend", message: 0 }], messages: ["First, reworded"] };
      expect(await it.repo.operations.rebaseInteractive(base, todo, false)).toBe("stopped");
      const operation = await it.repo.operations.current(null);
      // Recording HEAD before the reworded pick is a step of its own.
      expect(operation).toMatchObject({ kind: "rebase", source: "main", step: 1, steps: 4 });
      expect(await it.repo.operations.conflictedPaths()).toEqual(["same.txt"]);
      await it.repo.operations.resolve("same.txt", { use: "theirs" });
      expect(await it.repo.operations.continue()).toBe("stopped");
      await it.repo.operations.resolve("same.txt", { use: "theirs" });
      expect(await it.repo.operations.continue()).toBe("done");
      expect(await subjects(it, `${base}..HEAD`)).toEqual(["Second", "First, reworded"]);
      expect(await prepared(it)).toBe(false);
    });

    it("rewords nothing else when the reworded commit is skipped after a conflict", async () => {
      const it = await setup();
      const base = (await it.git("rev-parse", "HEAD")).trim();
      const first = await it.commit("same.txt", "first\n", "First");
      const second = await it.commit("same.txt", "second\n", "Second");
      const todo: RebaseTodo = { lines: [pick(second), pick(first), { command: "amend", message: 0 }], messages: ["First, reworded"] };
      expect(await it.repo.operations.rebaseInteractive(base, todo, false)).toBe("stopped");
      await it.repo.operations.resolve("same.txt", { use: "theirs" });
      // Now the reworded commit conflicts.
      expect(await it.repo.operations.continue()).toBe("stopped");
      expect(await it.repo.operations.skip()).toBe("done");
      expect(await subjects(it, `${base}..HEAD`)).toEqual(["Second"]);
      expect(await prepared(it)).toBe(false);
    });

    it("rewords nothing else when the reworded commit becomes empty", async () => {
      const it = await setup();
      const base = (await it.git("rev-parse", "HEAD")).trim();
      const one = await it.commit("same.txt", "1\n", "One");
      const two = await it.commit("same.txt", "2\n", "Two");
      const back = await it.commit("same.txt", "1\n", "Back to one");
      const todo: RebaseTodo = {
        lines: [pick(one), { command: "drop", hash: two }, pick(back), { command: "amend", message: 0 }],
        messages: ["Back to one, reworded"],
      };
      // Git drops a commit that became empty, or stops to ask about it.
      if ((await it.repo.operations.rebaseInteractive(base, todo, false)) === "stopped")
        expect(await it.repo.operations.skip()).toBe("done");
      expect(await subjects(it, `${base}..HEAD`)).toEqual(["One"]);
      expect(await prepared(it)).toBe(false);
    });

    it("cleans up what it prepared when the rebase is aborted", async () => {
      const it = await setup();
      const base = (await it.git("rev-parse", "HEAD")).trim();
      const first = await it.commit("same.txt", "first\n", "First");
      const second = await it.commit("same.txt", "second\n", "Second");
      const todo: RebaseTodo = { lines: [pick(second), pick(first), { command: "amend", message: 0 }], messages: ["First, reworded"] };
      expect(await it.repo.operations.rebaseInteractive(base, todo, false)).toBe("stopped");
      await it.repo.operations.abort();
      expect(await subjects(it, `${base}..HEAD`)).toEqual(["First", "Second"]);
      expect(await prepared(it)).toBe(false);
    });
  });
}

describeInteractiveRebase("local", async () => {
  const repository = await createRepository();
  return fixture(new LocalHost(machine), repository.root);
});

describe("WSL", async () => {
  const ubuntu = (await new HostFactory(machine).distributions()).includes("Ubuntu");
  if (!ubuntu) return it.skip("needs the Ubuntu distribution", () => undefined);
  describeInteractiveRebase("WSL", async () => {
    const host = new HostFactory(machine).connect({ kind: "wsl", distro: "Ubuntu", path: "/tmp" });
    const root = `/tmp/gitdesk-rebase-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const script = `mkdir -p ${root} && cd ${root} && git init -q -b main && git config user.name T && git config user.email t@x && git commit -q --allow-empty -m Initial`;
    await host.run("sh", ["-c", script], { cwd: "/" });
    onTestFinished(async () => {
      await host.run("rm", ["-rf", root], { cwd: "/" });
      host.dispose();
    });
    return fixture(host, root);
  });
});

describe("rebases", () => {
  async function diverged() {
    const repository = await createRepository({ "same.txt": "base\n" });
    const it = await fixture(new LocalHost(machine), repository.root);
    await it.git("switch", "-q", "-c", "feature");
    await it.commit("same.txt", "feature\n", "Feature");
    await it.commit("feature.txt", "f\n", "Feature only");
    await it.git("switch", "-q", "main");
    await it.commit("same.txt", "main\n", "Main");
    await it.git("switch", "-q", "feature");
    return { ...it, repository };
  }

  it("plans the commits a rebase rewrites, with the remote branches that have them", async () => {
    const it = await diverged();
    const remote = await createRemote();
    await it.git("remote", "add", "origin", remote);
    await it.git("push", "-q", "origin", "feature");
    const plan = await it.repo.operations.plan("main");
    expect(plan.base).toBe((await it.git("rev-parse", "main")).trim());
    expect(plan.commits.map((commit) => [commit.subject, commit.merge])).toEqual([
      ["Feature", false],
      ["Feature only", false],
    ]);
    expect(plan.commits[0]).toMatchObject({ message: "Feature", author: "Test" });
    expect(plan.pushed).toEqual(["origin/feature"]);
    expect(await it.repo.operations.isAncestorOfHead(plan.base)).toBe(false);
    expect(await it.repo.operations.isAncestorOfHead((await it.git("rev-parse", "HEAD~1")).trim())).toBe(true);
  });

  it("rebases onto a branch, stopping for conflicts that can be skipped", async () => {
    const it = await diverged();
    expect(await it.repo.operations.rebase("main", false)).toBe("stopped");
    expect(await it.repo.operations.current(null)).toMatchObject({ kind: "rebase", source: "feature", target: "main", step: 1, steps: 2 });
    expect(await it.repo.operations.skip()).toBe("done");
    expect(await subjects(it, "main..HEAD")).toEqual(["Feature only"]);
    expect(await it.repository.read("same.txt")).toBe("main\n");
  });

  it("aborts a rebase back to where it started, keeping stashed changes with --autostash", async () => {
    const it = await diverged();
    const before = (await it.git("rev-parse", "HEAD")).trim();
    await it.repository.write("feature.txt", "uncommitted\n");
    expect(await it.repo.operations.rebase("main", true)).toBe("stopped");
    await it.repo.operations.abort();
    expect((await it.git("rev-parse", "HEAD")).trim()).toBe(before);
    expect(await it.repository.read("feature.txt")).toBe("uncommitted\n");
    expect(await it.repo.operations.current(null)).toBeNull();
  });

  it("pulls by rebasing onto the upstream", async () => {
    const it = await diverged();
    const remote = await createRemote();
    await it.git("remote", "add", "origin", remote);
    await it.git("push", "-q", "-u", "origin", "main:main");
    await it.git("switch", "-q", "-c", "local", "main~1");
    await it.git("branch", "-q", "--set-upstream-to=origin/main");
    await it.commit("local.txt", "l\n", "Local");
    expect(await it.repo.pullRebase("origin", "local", false)).toBe("done");
    expect(await subjects(it, "HEAD~2..HEAD")).toEqual(["Main", "Local"]);
  });
});
