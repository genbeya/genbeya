import { execFile } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { Managers } from "../contracts/manager-contracts";
import type { SearchResults } from "../contracts/model";
import { connectManagers, dispatch } from "../contracts/rpc";
import { HostFactory } from "../access/hosts/host-factory";
import { SEARCH_LIMITS } from "../engines/search-engine";
import { nodeMachine } from "../platforms/node/node-machine";
import { createRepository, onTestFinished } from "../testing/repository";
import { temporaryFolder } from "../testing/temp";
import { createBackend } from "./backend";

const machine = nodeMachine();

const FILES: Record<string, string> = {
  ".gitdesk.yml": "name: Search Project\ntaskPrefix: TP\n",
  ".gitignore": "dist/\n",
  "docs/Home.md": "# Home\n\nWelcome.\n\n## Setup\n\nInstall the Gadget first.\nThen run it.\n",
  "tasks/TP-1.md": "---\nid: TP-1\ntitle: Ship the gadget\nstatus: todo\n---\n\nBuild the gadget.\n",
  "tasks/broken.md": "No frontmatter, but a gadget.\n",
  "src/gadget.ts": "// first\nexport const gadget = 1;\n",
};

async function opened(files: Record<string, string> = FILES) {
  const repository = await createRepository(files);
  const backend = await createBackend(machine, await temporaryFolder("data-"));
  onTestFinished(() => backend.dispose());
  const managers: Managers = connectManagers((request) => dispatch(backend, structuredClone(request)));
  const { id } = await managers.workspace.open({ kind: "local", path: repository.root });
  return { repository, managers, id, search: (text: string, options?: object) => managers.content.search(id, text, options) };
}

const paths = (results: SearchResults) => ({
  wiki: results.wiki.map((hit) => hit.path),
  tasks: results.tasks.map((hit) => hit.path),
  code: results.code.map((hit) => hit.path),
});

describe("ContentManager.search", () => {
  it("lists pages, tasks and code with their matching lines and the lines around them", async () => {
    const { search } = await opened();
    const results = await search("gadget");
    expect(results.truncated).toBe(false);
    expect(results.wiki).toEqual([
      {
        path: "docs/Home.md",
        scope: "content",
        title: "Home",
        matches: [{ line: 7, text: "Install the Gadget first.", ranges: [{ start: 12, end: 18 }], before: "", after: "Then run it." }],
      },
    ]);
    expect(results.tasks.map(({ id, title, status, scope }) => ({ id, title, status, scope }))).toEqual([
      { id: "TP-1", title: "Ship the gadget", status: "todo", scope: "content" },
      { id: "broken", title: "broken", status: "", scope: "content" },
    ]);
    expect(results.tasks[0]!.matches.map((match) => match.line)).toEqual([3, 7]);
    expect(results.code).toEqual([
      {
        path: "src/gadget.ts",
        scope: "repo",
        title: "gadget.ts",
        matches: [{ line: 2, text: "export const gadget = 1;", ranges: [{ start: 13, end: 19 }], before: "// first", after: null }],
      },
    ]);
  });

  it("finds new pages and files not yet committed, but nothing ignored or binary", async () => {
    const { managers, id, repository, search } = await opened();
    await managers.content.createPage(id, "docs/Gadgets.md");
    await repository.write("dist/bundle.js", "gadget\n");
    await repository.write("logo.png", new Uint8Array([0x89, 0x50, 0, 0, ...new TextEncoder().encode("gadget")]));
    expect(paths(await search("gadgets"))).toEqual({ wiki: ["docs/Gadgets.md"], tasks: [], code: [] });
    expect(paths(await search("gadget")).code).toEqual(["src/gadget.ts"]);
  });

  it("searches literally, ignoring case, unless asked otherwise", async () => {
    const { search } = await opened({
      "a.txt": "-e is an option\n",
      "b.txt": 'it\'s "quoted" and $(not run)\n',
      "c.txt": "a.*b\nGadget gadgets\n",
    });
    expect(paths(await search("-e")).code).toEqual(["a.txt"]);
    expect(paths(await search(`"quoted" and $(not`)).code).toEqual(["b.txt"]);
    expect(paths(await search("a.*b")).code).toEqual(["c.txt"]);
    expect((await search("gadget", { caseSensitive: true })).code[0]!.matches[0]!.ranges).toEqual([{ start: 7, end: 13 }]);
    expect((await search("gadget", { wholeWord: true })).code[0]!.matches[0]!.ranges).toEqual([{ start: 0, end: 6 }]);
    expect((await search("^a.+b$", { regex: true })).code[0]!.matches.map((match) => match.line)).toEqual([1]);
    await expect(search("(", { regex: true })).rejects.toThrow();
  });

  it("searches the content branch for pages and tasks, and the checkout only for code", async () => {
    const { managers, id, repository, search } = await opened();
    await managers.content.setStorage(id, "branch");
    const home = await managers.content.read(id, "content", "docs/Home.md");
    await managers.content.write(id, "content", "docs/Home.md", "# Home\n\nThe gadget moved here.\n", home.hash);
    // The checkout keeps its stale copy, which must not show up as well.
    expect(await repository.read("docs/Home.md")).toContain("Install the Gadget");
    const results = await search("gadget");
    expect(paths(results)).toEqual({ wiki: ["docs/Home.md"], tasks: ["tasks/TP-1.md", "tasks/broken.md"], code: ["src/gadget.ts"] });
    expect(results.wiki[0]!.matches.map((match) => match.text)).toEqual(["The gadget moved here."]);
  });

  it("caps files per area and matches per file, and shortens long lines", async () => {
    const files: Record<string, string> = { "long.min.js": `${"x".repeat(5000)}gadget${"y".repeat(5000)}\n` };
    for (let i = 0; i <= SEARCH_LIMITS.filesPerArea; i++) files[`src/file-${String(i).padStart(2, "0")}.ts`] = "gadget\n";
    files["many.txt"] = "gadget\n".repeat(SEARCH_LIMITS.matchesPerFile + 5);
    const { search } = await opened(files);
    const results = await search("gadget");
    expect(results.truncated).toBe(true);
    expect(results.code).toHaveLength(SEARCH_LIMITS.filesPerArea);
    const long = results.code.find((hit) => hit.path === "long.min.js")!.matches[0]!;
    expect(long.text.length).toBeLessThanOrEqual(SEARCH_LIMITS.lineLength + 2);
    expect(long.text.slice(long.ranges[0]!.start, long.ranges[0]!.end)).toBe("gadget");
    expect(results.code.find((hit) => hit.path === "many.txt")!.matches).toHaveLength(SEARCH_LIMITS.matchesPerFile);

    const fewer = await search("gadget", { caseSensitive: true, wholeWord: true });
    expect(fewer.code.some((hit) => hit.path === "long.min.js")).toBe(false);
  });

  it.each([
    ["empty text", "", undefined, "Enter text to search for."],
    ["text over the limit", "x".repeat(SEARCH_LIMITS.query + 1), undefined, "at most"],
    ["several lines", "a\nb", undefined, "one line"],
    ["invalid options", "a", { regex: 1 }, "Invalid search options."],
  ])("rejects %s", async (_, text, options, message) => {
    const { search } = await opened();
    await expect(search(text, options)).rejects.toThrow(message);
  });

  it("refuses repositories that are not open", async () => {
    const { managers } = await opened();
    await expect(managers.content.search("made-up", "gadget")).rejects.toThrow("no longer open");
  });
});

/** Search through the shell transport, when the Ubuntu distribution exists. */
describe("ContentManager.search on WSL", async () => {
  const ubuntu = (await new HostFactory(machine).distributions()).includes("Ubuntu");
  it.skipIf(!ubuntu)("searches a WSL repository, including untracked files", async () => {
    const dir = `/tmp/gitdesk-search-${Date.now()}`;
    const run = (script: string) =>
      new Promise((resolve, reject) =>
        execFile("wsl.exe", ["-d", "Ubuntu", "-e", "sh", "-c", script], (e) => (e ? reject(e) : resolve(null))),
      );
    await run(
      `mkdir -p ${dir}/docs ${dir}/src && cd ${dir} && git init -q -b main && git config user.name T && git config user.email t@x && ` +
        `printf '# Home\\n\\nA gadget.\\n' > docs/Home.md && git add . && git commit -q -m init && printf 'gadget -e\\n' > src/new.ts`,
    );
    const backend = await createBackend(machine, await temporaryFolder("data-"));
    onTestFinished(async () => {
      await backend.dispose();
      await run(`rm -rf ${dir}`);
    });
    const { id } = await backend.workspace.open({ kind: "wsl", distro: "Ubuntu", path: dir });
    expect(paths(await backend.content.search(id, "GADGET"))).toEqual({ wiki: ["docs/Home.md"], tasks: [], code: ["src/new.ts"] });
    expect((await backend.content.search(id, "-e")).code[0]!.matches[0]).toMatchObject({ line: 1, text: "gadget -e" });
  });
});
