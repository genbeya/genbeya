import { contentBranch, snapshot, task } from "../../testing/fake-platform";
import { allItems, branchItems, linkItem, mergeItems, rank, rebaseItems, type PaletteCommands } from "./palette-items";

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
    expect(items.some((item) => item.id === "sync-content")).toBe(false);
  });

  it("pushes, publishes a branch without upstream, pushes elsewhere and undoes the last commit", () => {
    const run = (id: string) => items.find((item) => item.id === id)!.run();
    expect(items.find((item) => item.id === "push")?.label).toBe("Push to origin");
    run("push");
    expect(calls.get("push")).toHaveBeenCalled();
    run("push-to");
    expect(calls.get("pushTo")).toHaveBeenCalled();
    run("undo-commit");
    expect(calls.get("undoLastCommit")).toHaveBeenCalled();

    const keys = { mod: "⌘", ctrl: "⌃" };
    const unpublished = allItems({ ...repository, head: { ...repository.head, upstream: null } }, [], "dark", keys, commands);
    expect(unpublished.find((item) => item.id === "push")?.label).toBe("Publish branch");
    const merging = allItems({ ...repository, operation: { kind: "merge" } as never }, [], "dark", keys, commands);
    expect(merging.some((item) => item.id === "undo-commit")).toBe(false);
  });

  it("lists the checkout's copy of an area on the content branch as files, and offers to sync it", () => {
    const shared = allItems({ ...repository, storage: contentBranch(["wiki"]) }, [], "dark", { mod: "⌘", ctrl: "⌃" }, commands);
    expect(shared.map((item) => item.id)).toEqual(expect.arrayContaining(["sync-content", "page:docs/Home.md", "file:docs/Home.md"]));
  });

  it("ranks matches with pages and tasks first, and leaves files out without a query", () => {
    expect(
      rank(items, "login", false)
        .slice(0, 2)
        .map((item) => item.label),
    ).toEqual(["Fix login", "login.ts"]);
    expect(rank(items, "", false).some((item) => item.group === "Files")).toBe(false);
  });

  it("leaves out everything a query matches nowhere", () => {
    expect(rank(items, "xyzzy", false)).toEqual([]);
  });

  it("toggles the terminal with Ctrl, also on macOS", () => {
    const toggle = items.find((item) => item.label === "Toggle terminal")!;
    expect(toggle.hint).toBe("⌃ `");
    expect(items.find((item) => item.id === "go:wiki")?.hint).toBe("⌘ 1");
    toggle.run();
    expect(commands.toggleTerminal).toHaveBeenCalled();
  });

  it("toggles the minimap among the preferences", () => {
    const [toggle] = rank(items, "minimap", false);
    expect(toggle).toMatchObject({ label: "Toggle minimap", group: "Preferences" });
    toggle!.run();
    expect(commands.toggleMinimap).toHaveBeenCalled();
  });

  it("brings back the tour and what's new, and opens the documentation", () => {
    for (const [query, command] of [
      ["tour", "startTour"],
      ["what's new", "showWhatsNew"],
      ["release notes", "showWhatsNew"],
      ["documentation", "openDocs"],
    ] as const) {
      const [first] = rank(items, query, false);
      expect(first?.group).toBe("Help");
      first!.run();
      expect(commands[command]).toHaveBeenCalled();
    }
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

  it("lists the branches to merge, with the upstream, but not the current branch", () => {
    const merges = mergeItems(repository, commands);
    expect(merges.map((item) => item.label)).toEqual(["feature", "origin/main", "origin/other"]);
    merges[1]!.run();
    expect(commands.merge).toHaveBeenCalledWith("origin/main", "remote");
    expect(items.find((item) => item.id === "merge")?.label).toBe("Merge into main…");
    const merging = allItems(
      { ...repository, operation: { kind: "merge", source: "x", target: "main", step: null, steps: null } },
      [],
      "dark",
      { mod: "", ctrl: "" },
      commands,
    );
    expect(merging.some((item) => item.id === "merge")).toBe(false);
  });

  it("lists the branches to rebase onto, and pulls by rebasing", () => {
    const rebases = rebaseItems(repository, commands);
    expect(rebases.map((item) => item.label)).toEqual(["feature", "origin/main", "origin/other"]);
    rebases[0]!.run();
    expect(commands.rebase).toHaveBeenCalledWith("feature");
    expect(items.find((item) => item.id === "rebase")?.label).toBe("Rebase main onto…");
    items.find((item) => item.id === "pull-rebase")!.run();
    expect(commands.pullRebase).toHaveBeenCalledWith("origin");
  });

  it("lists local and remote branches with an action to create one", () => {
    const branches = branchItems(repository, "new-name", commands);
    expect(branches.map((item) => item.label)).toEqual(["main", "feature", "origin/other", "Create branch…"]);
    expect(branches[0]?.hint).toBe("current");
    branches.at(-1)!.run();
    expect(commands.createBranch).toHaveBeenCalledWith("new-name");
  });
});
