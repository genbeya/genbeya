import { snapshot, task } from "../../testing/fake-platform";
import { allItems, branchItems, linkItem, rank, type PaletteCommands } from "./palette-items";

const calls = new Map<string, ReturnType<typeof vi.fn>>();
const commands = new Proxy({}, { get: (_, name: string) => calls.get(name) ?? calls.set(name, vi.fn()).get(name) }) as PaletteCommands;
const repository = snapshot({
  head: { branch: "main", commit: "a", upstream: "origin/main", ahead: 0, behind: 0 },
  branches: ["main", "feature"],
  remoteBranches: ["origin/other"],
  remotes: [{ name: "origin", url: "x" }],
  tasks: [task("TP-1", { title: "Fix login" })],
  files: [
    { name: "docs", path: "docs", children: [{ name: "Home.md", path: "docs/Home.md" }] },
    { name: "src", path: "src", children: [{ name: "login.ts", path: "src/login.ts" }] },
  ],
});

describe("palette items", () => {
  const items = allItems(repository, [], "dark", { mod: "⌘", ctrl: "⌃" }, commands);

  it("offers views, actions, pages, tasks and files, but not wiki files twice", () => {
    expect(items.map((item) => item.id)).toEqual(
      expect.arrayContaining(["go:wiki", "fetch", "push", "page:docs/Home.md", "task:tasks/TP-1.md", "file:src/login.ts"]),
    );
    expect(items.some((item) => item.id === "file:docs/Home.md")).toBe(false);
    expect(items.find((item) => item.id === "theme:dark")?.hint).toBe("current");
  });

  it("ranks matches with pages and tasks first, and leaves files out without a query", () => {
    expect(
      rank(items, "login", false)
        .slice(0, 2)
        .map((item) => item.label),
    ).toEqual(["Fix login", "login.ts"]);
    expect(rank(items, "", false).some((item) => item.group === "Files")).toBe(false);
  });

  it("toggles the terminal with Ctrl, also on macOS", () => {
    const toggle = items.find((item) => item.label === "Toggle terminal")!;
    expect(toggle.hint).toBe("⌃ `");
    expect(items.find((item) => item.id === "go:wiki")?.hint).toBe("⌘ 1");
    toggle.run();
    expect(commands.toggleTerminal).toHaveBeenCalled();
  });

  it("offers to search inside files", () => {
    const search = items.find((item) => item.id === "search-text")!;
    expect(search).toMatchObject({ label: "Search in files…", hint: "⌘ Shift F" });
    expect(rank(items, "grep", false)[0]).toBe(search);
    search.run();
    expect(commands.searchText).toHaveBeenCalled();
  });

  it("offers to open a pasted GitDesk link, and nothing for other text", () => {
    const item = linkItem("  gitdesk://open?remote=git@github.com:acme/demo.git&task=DP-1 ", commands)!;
    expect(item).toMatchObject({ label: "Open link", detail: "task DP-1 in github.com/acme/demo", icon: "link" });
    item.run();
    expect(commands.openLink).toHaveBeenCalledWith({ remote: "git@github.com:acme/demo.git", item: { kind: "task", id: "DP-1" } });
    expect(linkItem("login", commands)).toBeNull();
    expect(linkItem("gitdesk://open?remote=/srv/demo.git&task=DP-1", commands)).toBeNull();
  });

  it("lists local and remote branches with an action to create one", () => {
    const branches = branchItems(repository, "new-name", commands);
    expect(branches.map((item) => item.label)).toEqual(["main", "feature", "origin/other", "Create branch…"]);
    expect(branches[0]?.hint).toBe("current");
    branches.at(-1)!.run();
    expect(commands.createBranch).toHaveBeenCalledWith("new-name");
  });
});
