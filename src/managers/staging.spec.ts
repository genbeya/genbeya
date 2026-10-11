/**
 * Staging, unstaging and discarding hunks and lines, amending with the last
 * commit's changes staged, and .gitignore rules, against real repositories:
 * on this computer and, when the Ubuntu distribution exists, on WSL through
 * the shell transport.
 */
import { execFile } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { Managers } from "../contracts/manager-contracts";
import type { LineSelection } from "../contracts/model";
import { connectManagers, dispatch } from "../contracts/rpc";
import { HostFactory } from "../access/hosts/host-factory";
import { nodeMachine } from "../platforms/node/node-machine";
import { cloneRepository, createRemote, createRepository, onTestFinished } from "../testing/repository";
import { temporaryFolder } from "../testing/temp";
import { createBackend } from "./backend";

const machine = nodeMachine();
const ubuntu = (await new HostFactory(machine).distributions()).includes("Ubuntu");

const numbered = (count: number, change: Record<number, string> = {}) =>
  Array.from({ length: count }, (_, i) => `${change[i + 1] ?? `line ${i + 1}`}\n`).join("");
const select = (original: [number, number][], modified: [number, number][] = []): LineSelection => ({
  original: original.map(([from, to]) => ({ from, to })),
  modified: modified.map(([from, to]) => ({ from, to })),
});

/** A repository with committed `files`, opened through the transport, and ways to look at it from outside. */
interface Fixture {
  readonly managers: Managers;
  readonly id: string;
  git(...args: string[]): Promise<string>;
  write(path: string, content: string): Promise<void>;
  read(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
}

type Setup = (files: Record<string, string>) => Promise<Fixture>;

async function transport(): Promise<Managers & { dispose(): Promise<void> }> {
  const backend = await createBackend(machine, await temporaryFolder("data-"));
  onTestFinished(() => backend.dispose());
  return { ...connectManagers((request) => dispatch(backend, structuredClone(request))), dispose: () => backend.dispose() };
}

const local: Setup = async (files) => {
  const repository = await createRepository(files);
  const managers = await transport();
  const { id } = await managers.workspace.open({ kind: "local", path: repository.root });
  return { managers, id, git: repository.git, write: repository.write, read: repository.read, exists: repository.exists };
};

const wsl: Setup = async (files) => {
  const dir = `/tmp/gitdesk-staging-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const run = (script: string) =>
    new Promise<string>((resolve, reject) =>
      execFile("wsl.exe", ["-d", "Ubuntu", "-e", "sh", "-c", `cd ${dir} && ${script}`], { encoding: "buffer" }, (error, stdout) =>
        error ? reject(error) : resolve(stdout.toString("utf8")),
      ),
    );
  const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
  const write = async (path: string, content: string) => {
    await run(`mkdir -p "$(dirname ${quote(path)})" && printf %s ${Buffer.from(content).toString("base64")} | base64 -d > ${quote(path)}`);
  };
  await new Promise((resolve, reject) =>
    execFile("wsl.exe", ["-d", "Ubuntu", "-e", "mkdir", "-p", dir], (error) => (error ? reject(error) : resolve(null))),
  );
  await run("git init -q -b main && git config user.name T && git config user.email t@x && git config core.autocrlf false");
  for (const [path, content] of Object.entries(files)) await write(path, content);
  await run("git add . && git commit -q -m Initial");
  const managers = await transport();
  onTestFinished(async () => {
    await managers.dispose();
    await run(`rm -rf ${dir}`);
  });
  const { id } = await managers.workspace.open({ kind: "wsl", distro: "Ubuntu", path: dir });
  return {
    managers,
    id,
    git: (...args) => run(`git ${args.map(quote).join(" ")}`),
    write,
    read: (path) => run(`cat ${quote(path)}`),
    exists: async (path) => (await run(`if [ -e ${quote(path)} ]; then echo yes; fi`)).trim() === "yes",
  };
};

/** The cases every host must pass. */
function stagingCases(setup: Setup) {
  it("stages one hunk of a two-hunk file and commits just that", async () => {
    const { managers, id, git, write, read } = await setup({ "f.txt": numbered(20) });
    const edited = numbered(20, { 2: "two", 18: "eighteen" });
    await write("f.txt", edited);
    const { version } = await managers.versionControl.diff(id, "f.txt", "worktree");
    await managers.versionControl.stageLines(id, { path: "f.txt", version, lines: select([[2, 2]], [[2, 2]]) });
    await managers.versionControl.commit(id, "Second line", false);
    expect(await git("show", "HEAD:f.txt")).toBe(numbered(20, { 2: "two" }));
    expect(await read("f.txt")).toBe(edited);
  });

  it("unstages from the last commit while amending, keeping the file in the working tree", async () => {
    const { managers, id, git, write, read } = await setup({ "a.txt": "a\n" });
    await write("b.txt", "b\n");
    await write("c.txt", "c\n");
    await git("add", ".");
    await git("commit", "-q", "-m", "Add b and c");
    const amending = (await managers.workspace.snapshot(id, undefined, "parent"))!;
    expect(amending.changes).toEqual([
      { path: "b.txt", index: "A", worktree: " " },
      { path: "c.txt", index: "A", worktree: " " },
    ]);
    await managers.versionControl.unstage(id, ["b.txt"], "parent");
    await managers.versionControl.commit(id, "Add c", true);
    expect((await git("ls-tree", "--name-only", "HEAD")).split("\n").filter(Boolean)).toEqual(["a.txt", "c.txt"]);
    expect(await read("b.txt")).toBe("b\n");
    expect((await managers.workspace.snapshot(id))!.changes).toEqual([{ path: "b.txt", index: "?", worktree: "?" }]);
  });

  it("discards an untracked file with the folders it leaves empty", async () => {
    const { managers, id, write, exists } = await setup({ "tasks/TP-1.md": "# One\n" });
    await write("tasks/security/GENBEYA-9.md", "# Moved\n");
    await managers.versionControl.discard(id, ["tasks/security/GENBEYA-9.md"]);
    expect(await exists("tasks/security")).toBe(false);
    expect(await exists("tasks/TP-1.md")).toBe(true);
  });

  it("adds a rule to the .gitignore of a folder, in its line endings", async () => {
    const { managers, id, write, read } = await setup({ "src/.gitignore": "*.tmp\r\n", "src/main.ts": "x\n" });
    await write("src/out.log", "log\n");
    await managers.versionControl.ignore(id, "src/out.log", "file", "src");
    expect(await read("src/.gitignore")).toBe("*.tmp\r\n/out.log\r\n");
    const { changes } = (await managers.workspace.snapshot(id))!;
    expect(changes).toEqual([{ path: "src/.gitignore", index: " ", worktree: "M" }]);
  });
}

describe("Staging on this computer", () => {
  stagingCases(local);

  async function opened(files: Record<string, string>) {
    const fixture = await local(files);
    const vc = fixture.managers.versionControl;
    const version = async (path: string, source: "worktree" | "index" = "worktree", base?: "head" | "parent") =>
      (await vc.diff(fixture.id, path, source, undefined, base)).version;
    return { ...fixture, vc, version };
  }

  it("stages single added and removed lines", async () => {
    const { vc, id, git, write, version } = await opened({ "f.txt": "a\nb\nc\nd\n" });
    await write("f.txt", "a\nB\nc\nnew\nd\n");
    await vc.stageLines(id, { path: "f.txt", version: await version("f.txt"), lines: select([], [[4, 4]]) });
    expect(await git("show", ":f.txt")).toBe("a\nb\nc\nnew\nd\n");
    await vc.stageLines(id, { path: "f.txt", version: await version("f.txt"), lines: select([[2, 2]]) });
    expect(await git("show", ":f.txt")).toBe("a\nc\nnew\nd\n");
  });

  it("unstages hunks and lines of the staged diff", async () => {
    const { vc, id, git, write, version } = await opened({ "f.txt": numbered(20) });
    await write("f.txt", numbered(20, { 2: "two", 3: "three", 18: "eighteen" }));
    await git("add", "f.txt");
    await vc.unstageLines(id, { path: "f.txt", version: await version("f.txt", "index"), lines: select([[18, 18]], [[18, 18]]) });
    expect(await git("show", ":f.txt")).toBe(numbered(20, { 2: "two", 3: "three" }));
    await vc.unstageLines(id, { path: "f.txt", version: await version("f.txt", "index"), lines: select([[3, 3]], [[3, 3]]) });
    expect(await git("show", ":f.txt")).toBe(numbered(20, { 2: "two" }));
  });

  it("discards hunks and lines of the working tree, keeping what is staged", async () => {
    const { vc, id, git, write, read, version } = await opened({ "f.txt": numbered(20) });
    await write("f.txt", numbered(20, { 2: "two" }));
    await git("add", "f.txt");
    await write("f.txt", numbered(20, { 2: "two", 10: "ten", 18: "eighteen" }));
    await vc.discardLines(id, { path: "f.txt", version: await version("f.txt"), lines: select([[18, 18]], [[18, 18]]) });
    expect(await read("f.txt")).toBe(numbered(20, { 2: "two", 10: "ten" }));
    expect(await git("show", ":f.txt")).toBe(numbered(20, { 2: "two" }));
  });

  it("stages part of an untracked file and discards part of another, which stays untracked", async () => {
    const { vc, id, git, read, write, managers, version } = await opened({ "a.txt": "a\n" });
    await write("new.txt", "one\ntwo\nthree\n");
    await vc.stageLines(id, { path: "new.txt", version: await version("new.txt"), lines: select([], [[1, 2]]) });
    expect(await git("show", ":new.txt")).toBe("one\ntwo\n");
    expect(await read("new.txt")).toBe("one\ntwo\nthree\n");
    await write("other.txt", "keep\ndrop\n");
    await vc.discardLines(id, { path: "other.txt", version: await version("other.txt"), lines: select([], [[2, 2]]) });
    expect(await read("other.txt")).toBe("keep\n");
    expect((await managers.workspace.snapshot(id))!.changes).toContainEqual({ path: "other.txt", index: "?", worktree: "?" });
  });

  it("leaves an untracked file untracked when its lines cannot be staged", async () => {
    const { vc, id, managers, write, version } = await opened({ "a.txt": "a\n" });
    await write("new.txt", "one\n");
    const current = await version("new.txt");
    await expect(vc.stageLines(id, { path: "new.txt", version: current, lines: select([[1, 1]]) })).rejects.toThrow(
      "Select changed lines first.",
    );
    expect((await managers.workspace.snapshot(id))!.changes).toEqual([{ path: "new.txt", index: "?", worktree: "?" }]);
  });

  it("stages part of a deletion, and unstages part of a staged deletion", async () => {
    const { vc, id, git, version } = await opened({ "d.txt": "one\ntwo\nthree\n", "e.txt": "1\n2\n3\n" });
    await git("rm", "-q", "--cached", "e.txt");
    await git("rm", "-q", "d.txt");
    await git("reset", "-q", "--", "d.txt");
    await vc.stageLines(id, { path: "d.txt", version: await version("d.txt"), lines: select([[1, 1]]) });
    expect(await git("show", ":d.txt")).toBe("two\nthree\n");
    await vc.unstageLines(id, { path: "e.txt", version: await version("e.txt", "index"), lines: select([[2, 2]]) });
    expect(await git("show", ":e.txt")).toBe("2\n");
  });

  it("keeps Windows line endings and handles a last line without newline", async () => {
    const { vc, id, git, write, version } = await opened({ "crlf.txt": "a\r\nb\r\nc\r\n", "end.txt": "a\nb" });
    await write("crlf.txt", "a\r\nB\r\nc\r\nX\r\n");
    await vc.stageLines(id, { path: "crlf.txt", version: await version("crlf.txt"), lines: select([[2, 2]], [[2, 2]]) });
    expect(await git("show", ":crlf.txt")).toBe("a\r\nB\r\nc\r\n");
    await write("end.txt", "a\nb\nc");
    await vc.stageLines(id, { path: "end.txt", version: await version("end.txt"), lines: select([], [[3, 3]]) });
    expect(await git("show", ":end.txt")).toBe("a\nb\nc");
  });

  it("converts line endings as the repository says", async () => {
    const { vc, id, git, write, read, version } = await opened({ ".gitattributes": "*.txt text eol=crlf\n", "f.txt": "a\nb\nc\n" });
    await write("f.txt", "a\r\nB\r\nc\r\nX\r\n");
    await vc.stageLines(id, { path: "f.txt", version: await version("f.txt"), lines: select([], [[4, 4]]) });
    expect(await git("show", ":f.txt")).toBe("a\nb\nc\nX\n");
    await vc.discardLines(id, { path: "f.txt", version: await version("f.txt"), lines: select([[2, 2]], [[2, 2]]) });
    expect(await read("f.txt")).toBe("a\r\nb\r\nc\r\nX\r\n");
  });

  it("unstages lines of a renamed file without undoing the rename", async () => {
    const { vc, id, git, write } = await opened({ "old.txt": numbered(10) });
    await git("mv", "old.txt", "new.txt");
    await write("new.txt", numbered(10, { 5: "five" }));
    await git("add", "new.txt");
    const diff = await vc.diff(id, "new.txt", "index", "old.txt");
    expect(diff.original).toBe(numbered(10));
    await vc.unstageLines(id, { path: "new.txt", oldPath: "old.txt", version: diff.version, lines: select([[5, 5]], [[5, 5]]) });
    expect(await git("show", ":new.txt")).toBe(numbered(10));
    expect(await git("ls-files")).toBe("new.txt\n");
  });

  it("refuses lines chosen in an outdated diff, and binary files", async () => {
    const { vc, id, git, write, version } = await opened({ "f.txt": "a\n", "b.bin": "\0x" });
    await write("f.txt", "b\n");
    const outdated = await version("f.txt");
    await write("f.txt", "c\n");
    await expect(vc.stageLines(id, { path: "f.txt", version: outdated, lines: select([[1, 1]], [[1, 1]]) })).rejects.toThrow(
      "f.txt changed since its diff was shown.",
    );
    expect(await git("diff", "--cached", "--name-only")).toBe("");
    await write("b.bin", "\0y");
    await expect(vc.stageLines(id, { path: "b.bin", version: await version("b.bin"), lines: select([[1, 1]]) })).rejects.toThrow(
      "GitDesk can only stage b.bin as a whole.",
    );
  });

  it.each([
    ["selection", { original: [{ from: 0, to: 1 }], modified: [] }, "Invalid line selection."],
    ["range", { original: [{ from: 3, to: 2 }], modified: [] }, "Invalid line selection."],
    ["lines", null, "Invalid line selection."],
  ])("validates the %s", async (_name, lines, message) => {
    const { vc, id } = await opened({ "f.txt": "a\n" });
    await expect(vc.stageLines(id, { path: "f.txt", version: "0".repeat(64), lines: lines as LineSelection })).rejects.toThrow(message);
  });

  it("validates versions and comparison bases", async () => {
    const { vc, id, managers } = await opened({ "f.txt": "a\n" });
    await expect(vc.stageLines(id, { path: "f.txt", version: "HEAD", lines: select([]) })).rejects.toThrow("Invalid diff version.");
    await expect(vc.unstage(id, ["f.txt"], "HEAD~1" as never)).rejects.toThrow("Invalid comparison base.");
    await expect(managers.workspace.snapshot(id, undefined, "origin" as never)).rejects.toThrow("Invalid comparison base.");
    await expect(vc.diff(id, "f.txt", "index", undefined, "x" as never)).rejects.toThrow("Invalid comparison base.");
  });

  describe("amending", () => {
    it("shows the last commit's changes as staged, with anything staged on top", async () => {
      const { managers, id, git, write } = await opened({ "a.txt": "a\n", "b.txt": "b\n" });
      await write("a.txt", "A\n");
      await git("mv", "b.txt", "c.txt");
      await git("commit", "-q", "-am", "Change a, rename b");
      await write("d.txt", "d\n");
      await git("add", "d.txt");
      await write("a.txt", "AA\n");
      const snapshot = (await managers.workspace.snapshot(id, undefined, "parent"))!;
      expect(snapshot.amending).toEqual({
        commit: expect.stringMatching(/^[0-9a-f]{7,}$/),
        parent: expect.any(String),
        merge: false,
        pushed: [],
      });
      expect(snapshot.changes).toEqual([
        { path: "a.txt", index: "M", worktree: "M" },
        { path: "c.txt", oldPath: "b.txt", index: "R", worktree: " " },
        { path: "d.txt", index: "A", worktree: " " },
      ]);
      const normal = (await managers.workspace.snapshot(id))!;
      expect(normal.amending).toBeUndefined();
      expect(normal.changes).toEqual([
        { path: "a.txt", index: " ", worktree: "M" },
        { path: "d.txt", index: "A", worktree: " " },
      ]);
      expect(normal.version).not.toBe(snapshot.version);
    });

    it("unstages renames and lines from the last commit", async () => {
      const { managers, id, vc, git, write, version } = await opened({ "a.txt": numbered(20), "b.txt": "b\n" });
      await write("a.txt", numbered(20, { 2: "two", 18: "eighteen" }));
      await git("mv", "b.txt", "c.txt");
      await git("commit", "-q", "-am", "Change a, rename b");
      const diff = await vc.diff(id, "a.txt", "index", undefined, "parent");
      expect(diff.original).toBe(numbered(20));
      await vc.unstageLines(
        id,
        { path: "a.txt", version: await version("a.txt", "index", "parent"), lines: select([[18, 18]], [[18, 18]]) },
        "parent",
      );
      await vc.unstage(id, ["c.txt"], "parent");
      await vc.commit(id, "Change a", true);
      expect(await git("show", "HEAD:a.txt")).toBe(numbered(20, { 2: "two" }));
      expect((await git("ls-tree", "--name-only", "HEAD")).split("\n").filter(Boolean)).toEqual(["a.txt", "b.txt"]);
      expect((await managers.workspace.snapshot(id))!.changes).toEqual([
        { path: "a.txt", index: " ", worktree: "M" },
        { path: "b.txt", index: " ", worktree: "D" },
        { path: "c.txt", index: "?", worktree: "?" },
      ]);
    });

    it("compares a first commit with nothing", async () => {
      const { managers, id, vc, git } = await opened({ "a.txt": "a\n", "b.txt": "b\n" });
      const snapshot = (await managers.workspace.snapshot(id, undefined, "parent"))!;
      expect(snapshot.amending).toMatchObject({ parent: null, merge: false });
      expect(snapshot.changes.map((change) => [change.path, change.index])).toEqual([
        ["a.txt", "A"],
        ["b.txt", "A"],
      ]);
      expect((await vc.diff(id, "a.txt", "index", undefined, "parent")).original).toBe("");
      await vc.unstage(id, ["b.txt"], "parent");
      await vc.commit(id, "Just a", true);
      expect(await git("ls-tree", "--name-only", "HEAD")).toBe("a.txt\n");
    });

    it("has nothing to amend before the first commit", async () => {
      const repository = await createRepository({ "a.txt": "a\n" }, false);
      const managers = await transport();
      const { id } = await managers.workspace.open({ kind: "local", path: repository.root });
      await repository.git("add", "a.txt");
      const snapshot = (await managers.workspace.snapshot(id, undefined, "parent"))!;
      expect(snapshot.amending).toBeUndefined();
      expect(snapshot.changes).toEqual([{ path: "a.txt", index: "A", worktree: " " }]);
      await expect(managers.versionControl.unstage(id, ["a.txt"], "parent")).rejects.toThrow("There is no commit to amend yet.");
    });

    it("compares a merge with its first parent and says where the commit was pushed", async () => {
      const remote = await createRemote();
      const clone = await cloneRepository(remote);
      await clone.write("a.txt", "a\n");
      await clone.git("add", ".");
      await clone.git("commit", "-q", "-m", "Initial");
      await clone.git("switch", "-q", "-c", "side");
      await clone.write("side.txt", "side\n");
      await clone.git("add", ".");
      await clone.git("commit", "-q", "-m", "Side");
      await clone.git("switch", "-q", "main");
      await clone.write("main.txt", "main\n");
      await clone.git("add", ".");
      await clone.git("commit", "-q", "-m", "Main");
      await clone.git("merge", "-q", "--no-ff", "-m", "Merge side", "side");
      await clone.git("push", "-q", "origin", "main");
      const managers = await transport();
      const { id } = await managers.workspace.open({ kind: "local", path: clone.root });
      const snapshot = (await managers.workspace.snapshot(id, undefined, "parent"))!;
      expect(snapshot.amending).toMatchObject({ merge: true, pushed: ["origin/main"] });
      expect(snapshot.changes).toEqual([{ path: "side.txt", index: "A", worktree: " " }]);
      await managers.versionControl.commit(id, "Merge side, amended", true);
      expect((await clone.git("log", "-1", "--format=%P")).trim().split(" ")).toHaveLength(2);
    });
  });

  describe(".gitignore", () => {
    it("ignores an untracked file at the root, creating .gitignore", async () => {
      const { vc, id, read, write, managers } = await opened({ "a.txt": "a\n" });
      await write("debug [1].log", "x\n");
      await vc.ignore(id, "debug [1].log", "file", "");
      expect(await read(".gitignore")).toBe("/debug \\[1].log\n");
      expect((await managers.workspace.snapshot(id))!.changes).toEqual([{ path: ".gitignore", index: "?", worktree: "?" }]);
    });

    it("ignores folders and extensions, once", async () => {
      const { vc, id, read, write, managers } = await opened({ ".gitignore": "node_modules/", "a.txt": "a\n" });
      await write("build/out/x.js", "x\n");
      await write("src/notes.tmp", "x\n");
      await vc.ignore(id, "build/out", "folder", "");
      await vc.ignore(id, "src/notes.tmp", "extension", "src");
      await vc.ignore(id, "build/out", "folder", "");
      expect(await read(".gitignore")).toBe("node_modules/\n/build/out/\n");
      expect(await read("src/.gitignore")).toBe("*.tmp\n");
      expect((await managers.workspace.snapshot(id))!.changes.map((change) => change.path)).toEqual([".gitignore", "src/.gitignore"]);
    });

    it("stops tracking files and folders, keeping them on disk", async () => {
      const { vc, id, read, git } = await opened({ "a.txt": "a\n", "logs/1.log": "1\n", "logs/2.log": "2\n" });
      await vc.untrack(id, ["a.txt", "logs"]);
      expect(await git("ls-files")).toBe("");
      expect(await read("logs/2.log")).toBe("2\n");
    });

    it.each([
      ["a kind", "a.txt", "everything", "", "Invalid kind of rule."],
      ["an extension", "src/Makefile", "extension", "", "src/Makefile has no extension."],
      ["a location holding the path", "src/a.ts", "file", "lib", "lib/.gitignore can't ignore src/a.ts."],
      ["a path", "../a.txt", "file", "", "not a valid path"],
    ])("validates %s", async (_name, path, kind, location, message) => {
      const { vc, id } = await opened({ "a.txt": "a\n" });
      await expect(vc.ignore(id, path, kind as never, location)).rejects.toThrow(message);
    });
  });
});

describe.skipIf(!ubuntu)("Staging on WSL", () => {
  stagingCases(wsl);
});
