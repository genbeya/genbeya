import { describe, expect, it, vi } from "vitest";
import { nodeMachine } from "../../platforms/node/node-machine";
import { createRepository } from "../../testing/repository";
import { LocalHost } from "../hosts/local-host";
import { TIMED_OUT, TOO_MUCH_OUTPUT, type RunResult } from "../ports";
import { Git } from "./git";
import { grepFiles, grepLines, parseGrepLines, parseGrepParts, type GrepPattern } from "./git-grep";

const host = new LocalHost(nodeMachine());
const literal = (text: string, change: Partial<GrepPattern> = {}): GrepPattern => ({
  text,
  regex: false,
  caseSensitive: false,
  wholeWord: false,
  ...change,
});

async function repository(files: Record<string, string>) {
  const repo = await createRepository(files);
  return { repo, git: new Git(host, host.paths.normalize(repo.root)) };
}

describe("grepFiles", () => {
  it("finds tracked and untracked files, but not ignored or binary ones", async () => {
    const { repo, git } = await repository({ ".gitignore": "build/\n", "src/a.ts": "const needle = 1;\n", "b.md": "no\n" });
    await repo.write("notes/new page.md", "A NEEDLE here\n");
    await repo.write("build/out.js", "needle\n");
    await repo.write("image.bin", new Uint8Array([0, 1, 2, ...new TextEncoder().encode("needle")]));
    expect((await grepFiles(git, literal("needle"))).sort()).toEqual(["notes/new page.md", "src/a.ts"]);
  });

  it("matches the query literally, whatever characters it holds", async () => {
    const { git } = await repository({
      "a.txt": "call -e now\n",
      "b.txt": 'it\'s "quoted"\n',
      "c.txt": "a.*b and [x] (y)\n",
      "d.txt": "--version\n",
      "e.txt": "aXXb\n",
    });
    expect(await grepFiles(git, literal("-e"))).toEqual(["a.txt"]);
    expect(await grepFiles(git, literal(`it's "quoted"`))).toEqual(["b.txt"]);
    expect(await grepFiles(git, literal("a.*b"))).toEqual(["c.txt"]);
    expect(await grepFiles(git, literal("[x] (y)"))).toEqual(["c.txt"]);
    expect(await grepFiles(git, literal("--version"))).toEqual(["d.txt"]);
  });

  it("ignores case unless asked, and matches regular expressions and whole words on request", async () => {
    const { git } = await repository({ "a.txt": "Login form\n", "b.txt": "relogin\n", "c.txt": "log in\n" });
    expect(await grepFiles(git, literal("login"))).toEqual(["a.txt", "b.txt"]);
    expect(await grepFiles(git, literal("login", { caseSensitive: true }))).toEqual(["b.txt"]);
    expect(await grepFiles(git, literal("login", { wholeWord: true }))).toEqual(["a.txt"]);
    expect(await grepFiles(git, literal("log ?in", { regex: true }))).toEqual(["a.txt", "b.txt", "c.txt"]);
  });

  it("finds nothing without failing, and reports invalid regular expressions", async () => {
    const { git } = await repository({ "a.txt": "text\n" });
    expect(await grepFiles(git, literal("absent"))).toEqual([]);
    await expect(grepFiles(git, literal("(", { regex: true }))).rejects.toThrow();
  });
});

describe("grepLines", () => {
  it("returns matching lines and one line of context, of the given files only", async () => {
    const { git } = await repository({
      "a b.txt": "one\nneedle two\nthree\nfour\nfive\n12 six\nneedle seven\r\n",
      "other.txt": "needle\n",
    });
    expect(await grepLines(git, literal("needle"), ["a b.txt"], 10)).toEqual([
      { path: "a b.txt", line: 1, text: "one", match: false, ranges: [] },
      { path: "a b.txt", line: 2, text: "needle two", match: true, ranges: [{ start: 0, end: 6 }] },
      { path: "a b.txt", line: 3, text: "three", match: false, ranges: [] },
      { path: "a b.txt", line: 6, text: "12 six", match: false, ranges: [] },
      { path: "a b.txt", line: 7, text: "needle seven", match: true, ranges: [{ start: 0, end: 6 }] },
    ]);
  });

  it("searches untracked files it is given, and nothing when given no files", async () => {
    const { repo, git } = await repository({ "a.txt": "x\n" });
    await repo.write("Ünïcode.md", "needle\n");
    expect(await grepLines(git, literal("needle"), ["Ünïcode.md"], 10)).toEqual([
      { path: "Ünïcode.md", line: 1, text: "needle", match: true, ranges: [{ start: 0, end: 6 }] },
    ]);
    expect(await grepLines(git, literal("needle"), [], 10)).toEqual([]);
  });

  it("takes the ranges from git, counting characters rather than bytes", async () => {
    const { git } = await repository({ "a.txt": "héllo 😀 Needle needle_x needle\n" });
    const ranges = async (pattern: GrepPattern) => (await grepLines(git, pattern, ["a.txt"], 10))[0]!.ranges;
    expect(await ranges(literal("needle"))).toEqual([
      { start: 9, end: 15 },
      { start: 16, end: 22 },
      { start: 25, end: 31 },
    ]);
    expect(await ranges(literal("needle", { caseSensitive: true, wholeWord: true }))).toEqual([{ start: 25, end: 31 }]);
    expect(await ranges(literal("needle", { wholeWord: true }))).toEqual([
      { start: 9, end: 15 },
      { start: 25, end: 31 },
    ]);
    expect(await ranges(literal("é.lo|Ne+dle", { regex: true, caseSensitive: true }))).toEqual([
      { start: 1, end: 5 },
      { start: 9, end: 15 },
    ]);
  });

  it("never runs a regular expression itself, so a pathological one stays fast", async () => {
    const { git } = await repository({ "a.txt": `${"a".repeat(40)}c\n` });
    const started = performance.now();
    const [line] = await grepLines(git, literal("(a+)+b|c", { regex: true }), ["a.txt"], 10);
    expect(line!.ranges).toEqual([{ start: 40, end: 41 }]);
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it("lists at most so many matches per file", async () => {
    const { git } = await repository({ "a.txt": "needle\n".repeat(50), "b.txt": "needle\n" });
    const lines = await grepLines(git, literal("needle"), ["a.txt", "b.txt"], 3);
    expect(lines.filter((line) => line.match).map((line) => [line.path, line.line])).toEqual([
      ["a.txt", 1],
      ["a.txt", 2],
      ["a.txt", 3],
      ["b.txt", 1],
    ]);
  });
});

/** A git that answers `grep` with `reply`, recording the arguments. */
function fakeGit(reply: (args: readonly string[]) => Promise<RunResult>) {
  const calls: string[][] = [];
  const git = {
    run: (args: readonly string[]) => {
      calls.push([...args]);
      return reply(args);
    },
  } as unknown as Git;
  return { git, calls };
}

const result = (code: number, stdout = "", stderr = ""): RunResult => ({ code, stdout: new TextEncoder().encode(stdout), stderr });

describe("git grep failures", () => {
  it("cuts the output itself where git has no --max-count", async () => {
    const output = "a\x001\x001\x00x\na\x002\x001\x00x\na\x003\x001\x00x\n";
    const { git, calls } = fakeGit(async (args) =>
      args.some((arg) => arg.startsWith("--max-count")) ? result(129, "", "error: unknown option `max-count=2'") : result(0, output),
    );
    expect((await grepLines(git, literal("x"), ["a"], 2)).map((line) => line.line)).toEqual([1, 2]);
    await grepLines(git, literal("x"), ["a"], 2);
    expect(calls.filter((args) => args.some((arg) => arg.startsWith("--max-count")))).toHaveLength(1);
  });

  it("explains output too large to read and searches that take too long", async () => {
    await expect(grepFiles(fakeGit(async () => result(TOO_MUCH_OUTPUT)).git, literal("x"))).rejects.toThrow("found too much");
    await expect(grepFiles(fakeGit(async () => result(TIMED_OUT)).git, literal("x"))).rejects.toThrow("took too long");
    const now = vi.spyOn(Date, "now");
    now.mockReturnValueOnce(0).mockReturnValueOnce(25_000);
    const timedOut = fakeGit(async () => Promise.reject(new Error("WSL (Ubuntu) did not respond in time.")));
    await expect(grepFiles(timedOut.git, literal("x"))).rejects.toThrow("took too long");
    now.mockRestore();
    const failed = fakeGit(async () => Promise.reject(new Error("The connection to WSL (Ubuntu) is closed.")));
    await expect(grepFiles(failed.git, literal("x"))).rejects.toThrow("connection");
  });

  it("still lists matching lines when git cannot say where they match", async () => {
    const { git } = fakeGit(async (args) => (args.includes("-o") ? result(TOO_MUCH_OUTPUT) : result(0, "a\x001\x001\x00x\n")));
    expect(await grepLines(git, literal("x"), ["a"], 2)).toEqual([{ path: "a", line: 1, text: "x", match: true, ranges: [] }]);
  });
});

describe("parseGrepLines", () => {
  it("tells matches from context lines by their column, whatever the text", () => {
    const output = "a\0" + "1\0" + "12\n" + "a\0" + "2\0" + "3\0x\n" + "--\n" + "b:c\n\0" + "9\0" + "-- z\n";
    expect(parseGrepLines(output)).toEqual([
      { path: "a", line: 1, text: "12", match: false, ranges: [] },
      { path: "a", line: 2, text: "x", match: true, ranges: [] },
      { path: "b:c\n", line: 9, text: "-- z", match: false, ranges: [] },
    ]);
  });

  it("keeps at most so many matches per file, with the context after the last one", () => {
    const record = (line: number, match: boolean) => `a\0${line}\0${match ? "1\0" : ""}t\n`;
    const output = record(1, true) + record(2, false) + record(3, true) + record(4, false) + record(5, true) + record(6, false);
    expect(parseGrepLines(output, 1).map((line) => line.line)).toEqual([1, 2]);
    expect(parseGrepLines(output, 2).map((line) => line.line)).toEqual([1, 2, 3, 4]);
  });
});

describe("parseGrepParts", () => {
  it("reads the matched parts of each line, by path and line", () => {
    const output = "a\0" + "1\0" + "3\0xy\n" + "a\0" + "1\0" + "9\0z\r\n" + "b\0" + "2\0" + "1\0w\n";
    expect(parseGrepParts(output)).toEqual(
      new Map([
        [
          "a",
          new Map([
            [
              1,
              [
                { byte: 2, text: "xy" },
                { byte: 8, text: "z" },
              ],
            ],
          ]),
        ],
        ["b", new Map([[2, [{ byte: 0, text: "w" }]]])],
      ]),
    );
  });
});
