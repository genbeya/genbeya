import type { SearchMatch, SearchResults } from "../../../../contracts/model";
import { describeResults, searchItems, searchText, segments, type SearchCommands } from "./search-items";

const match = (line: number, text: string, start: number, end: number): SearchMatch => ({
  line,
  text,
  ranges: [{ start, end }],
  before: null,
  after: null,
});

const RESULTS: SearchResults = {
  wiki: [{ path: "docs/Home.md", scope: "content", title: "Home", matches: [match(7, "Install the gadget", 12, 18)] }],
  tasks: [
    {
      path: "tasks/TP-1.md",
      scope: "content",
      title: "Ship it",
      id: "TP-1",
      status: "todo",
      matches: [match(3, "gadget", 0, 6), match(9, "a gadget", 2, 8)],
    },
  ],
  code: [{ path: "src/gadget.ts", scope: "repo", title: "gadget.ts", matches: [match(2, "  const gadget = 1;", 8, 14)] }],
  truncated: false,
};

describe("search items", () => {
  it("asks for full-text search with a leading slash", () => {
    expect(searchText("/gadget")).toBe("gadget");
    expect(searchText("/")).toBe("");
    expect(searchText("gadget")).toBeNull();
  });

  it("lists every match under its area and file, and opens it where it is", () => {
    const commands: SearchCommands = { openPage: vi.fn(), openTask: vi.fn(), openFile: vi.fn() };
    const items = searchItems(RESULTS, commands);
    expect(items.map((item) => [item.group, item.match!.file, item.match!.fileDetail, item.match!.line])).toEqual([
      ["Wiki", "Home", "docs/Home.md", 7],
      ["Tasks", "TP-1 Ship it", "todo", 3],
      ["Tasks", "TP-1 Ship it", "todo", 9],
      ["Code", "src/gadget.ts", "", 2],
    ]);
    expect(items[3]!.label).toBe("src/gadget.ts, line 2: const gadget = 1;");
    items[0]!.run();
    items[2]!.run();
    items[3]!.run();
    expect(commands.openPage).toHaveBeenCalledWith("docs/Home.md", 7);
    expect(commands.openTask).toHaveBeenCalledWith("TP-1");
    expect(commands.openFile).toHaveBeenCalledWith("src/gadget.ts", 2, "repo");
  });

  it("cuts lines into plain and highlighted parts, dropping the indentation", () => {
    expect(
      segments("    a gadget and a Gadget", [
        { start: 19, end: 25 },
        { start: 6, end: 12 },
      ]),
    ).toEqual([
      { text: "a ", mark: false },
      { text: "gadget", mark: true },
      { text: " and a ", mark: false },
      { text: "Gadget", mark: true },
    ]);
    expect(segments("  plain", [])).toEqual([{ text: "plain", mark: false }]);
    expect(segments("  x", [{ start: 0, end: 3 }])).toEqual([{ text: "  x", mark: true }]);
  });

  it("counts matches and files, and says when there are more", () => {
    expect(describeResults(RESULTS)).toBe("4 matches in 3 files");
    expect(describeResults({ ...RESULTS, code: [], tasks: [], truncated: true })).toBe("1 match in 1 file, more not shown");
    expect(describeResults({ wiki: [], tasks: [], code: [], truncated: false })).toBe("No matches");
  });
});
