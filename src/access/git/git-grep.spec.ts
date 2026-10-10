import { describe, expect, it } from "vitest";
import { nodeMachine } from "../../platforms/node/node-machine";
import { createRepository } from "../../testing/repository";
import { LocalHost } from "../hosts/local-host";
import { Git } from "./git";
import { grepFiles, grepLines, parseGrepLines, type GrepPattern } from "./git-grep";

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
    expect(await grepLines(git, literal("needle"), ["a b.txt"])).toEqual([
      { path: "a b.txt", line: 1, text: "one", match: false },
      { path: "a b.txt", line: 2, text: "needle two", match: true },
      { path: "a b.txt", line: 3, text: "three", match: false },
      { path: "a b.txt", line: 6, text: "12 six", match: false },
      { path: "a b.txt", line: 7, text: "needle seven", match: true },
    ]);
  });

  it("searches untracked files it is given, and nothing when given no files", async () => {
    const { repo, git } = await repository({ "a.txt": "x\n" });
    await repo.write("Ünïcode.md", "needle\n");
    expect(await grepLines(git, literal("needle"), ["Ünïcode.md"])).toEqual([{ path: "Ünïcode.md", line: 1, text: "needle", match: true }]);
    expect(await grepLines(git, literal("needle"), [])).toEqual([]);
  });
});

describe("parseGrepLines", () => {
  it("tells matches from context lines by their column, whatever the text", () => {
    const output = "a\0" + "1\0" + "12\n" + "a\0" + "2\0" + "3\0x\n" + "--\n" + "b:c\n\0" + "9\0" + "-- z\n";
    expect(parseGrepLines(output)).toEqual([
      { path: "a", line: 1, text: "12", match: false },
      { path: "a", line: 2, text: "x", match: true },
      { path: "b:c\n", line: 9, text: "-- z", match: false },
    ]);
  });
});
