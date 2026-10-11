import { expect, MOD, test, FILES } from "./app";

const numbered = (count: number, change: Record<number, string> = {}) =>
  Array.from({ length: count }, (_, i) => `${change[i + 1] ?? `line ${i + 1}`}\n`).join("");

test.describe("staging parts of files, the tree, .gitignore and amending", () => {
  test.use({ files: { ...FILES, "f.txt": numbered(20), "src/a.ts": "a\n", "src/b.ts": "b\n" } });

  test("stages one hunk of a two-hunk file and commits just that", async ({ window, repository }) => {
    repository.write("f.txt", numbered(20, { 2: "two", 18: "eighteen" }));
    await window.keyboard.press(`${MOD}+4`);
    await window.locator("gd-change-row", { hasText: "f.txt" }).click();
    const bars = window.locator(".cm-hunkBar");
    await expect(bars).toHaveCount(2);
    await bars.first().getByRole("button", { name: "Stage hunk" }).click();
    await expect(window.getByRole("region", { name: "Staged changes" }).locator("gd-change-row", { hasText: "f.txt" })).toBeVisible();
    await expect(bars).toHaveCount(1);
    await window.getByRole("textbox", { name: "Commit message" }).fill("Change line two");
    await window.keyboard.press(`${MOD}+Enter`);
    await expect(window.getByRole("region", { name: "Staged changes" })).toBeHidden();
    expect(repository.git("show", "HEAD:f.txt")).toBe(numbered(20, { 2: "two" }));
    expect(repository.read("f.txt")).toBe(numbered(20, { 2: "two", 18: "eighteen" }));
  });

  test("stages a single line selected by its number", async ({ window, repository }) => {
    repository.write("f.txt", numbered(20, { 3: "line 3\nnew A\nnew B" }));
    await window.keyboard.press(`${MOD}+4`);
    await window.locator("gd-change-row", { hasText: "f.txt" }).click();
    await expect(window.locator(".cm-hunkBar")).toHaveCount(1);
    await window.locator(".cm-merge-b .cm-lineNumbers .cm-gutterElement", { hasText: /^5$/ }).click();
    await expect(window.getByRole("toolbar", { name: "Selected lines" })).toContainText("1 line selected");
    await window.getByRole("button", { name: "Stage selected lines" }).click();
    await expect.poll(() => repository.git("show", ":f.txt")).toBe(numbered(20, { 3: "line 3\nnew B" }));
  });

  // With repeated lines, CodeMirror's own diff shows these changes a line away from where git has them.
  test("stages and discards hunks of a file with repeated lines exactly as shown", async ({ window, repository }) => {
    const text = (...rows: string[]) => rows.map((row) => `${row}\n`).join("");
    repository.write("blocks.ts", text("  x();", "{", "}", "{", "", "if (a) {", "  y();", "", "return;", "if (a) {"));
    repository.git("add", "blocks.ts");
    repository.git("commit", "-q", "-m", "Add blocks");
    repository.write("blocks.ts", text("  x();", "{", "  y();", "{", "}", "{", "{", "", "if (a) {", "  y();", "return;", "if (a) {"));
    await window.keyboard.press(`${MOD}+4`);
    await window.locator("gd-change-row", { hasText: "blocks.ts" }).click();
    const bars = window.locator(".cm-hunkBar");
    await expect(bars).toHaveCount(3);
    await bars.first().getByRole("button", { name: "Stage hunk" }).click();
    await expect
      .poll(() => repository.git("show", ":blocks.ts"))
      .toBe(text("  x();", "{", "  y();", "{", "}", "{", "", "if (a) {", "  y();", "", "return;", "if (a) {"));
    await expect(bars).toHaveCount(2);
    await bars.last().getByRole("button", { name: "Discard hunk" }).click();
    await window.getByRole("dialog").getByRole("button", { name: "Discard" }).click();
    await expect
      .poll(() => repository.read("blocks.ts"))
      .toBe(text("  x();", "{", "  y();", "{", "}", "{", "{", "", "if (a) {", "  y();", "", "return;", "if (a) {"));
    await expect(bars).toHaveCount(1);
  });

  test("selects a replaced line with a click next to its removed version, inline", async ({ window, repository }) => {
    repository.write("f.txt", numbered(20, { 5: "five\nmore" }));
    await window.keyboard.press(`${MOD}+4`);
    await window.locator("gd-change-row", { hasText: "f.txt" }).click();
    await window.getByRole("button", { name: "Inline" }).click();
    const removed = (await window.locator(".cm-deletedChunk").boundingBox())!;
    const gutter = (await window.locator(".cm-gutters").first().boundingBox())!;
    await window.mouse.click(gutter.x + gutter.width / 2, removed.y + removed.height / 2);
    await expect(window.getByRole("toolbar", { name: "Selected lines" })).toContainText("3 lines selected");
    await window.getByRole("button", { name: "Stage selected lines" }).click();
    await expect.poll(() => repository.git("show", ":f.txt")).toBe(numbered(20, { 5: "five\nmore" }));
  });

  test("shows changes as a tree and stages a folder", async ({ window, repository }) => {
    repository.write("src/a.ts", "A\n");
    repository.write("src/b.ts", "B\n");
    await window.keyboard.press(`${MOD}+4`);
    await expect(window.locator("gd-change-row", { hasText: "a.ts" })).toBeVisible();
    await window.getByRole("button", { name: "Show as tree" }).click();
    const tree = window.getByRole("tree", { name: "Changes" });
    const folder = tree.getByRole("treeitem", { name: /src/ }).first();
    await expect(folder).toContainText("2");
    await folder.hover();
    await folder.getByRole("button", { name: "Stage src" }).click();
    await expect(window.getByRole("tree", { name: "Staged changes" }).locator("gd-change-row")).toHaveCount(2);
    expect(repository.git("diff", "--cached", "--name-only")).toBe("src/a.ts\nsrc/b.ts\n");
  });

  test("ignores an untracked file", async ({ window, repository }) => {
    repository.write("debug.log", "noise\n");
    await window.keyboard.press(`${MOD}+4`);
    await window.locator("gd-change-row", { hasText: "debug.log" }).click({ button: "right" });
    await window.getByRole("menuitem", { name: "Ignore file debug.log…" }).click();
    const dialog = window.getByRole("dialog", { name: "Ignore file" });
    await expect(dialog.locator("pre")).toHaveText("/debug.log");
    await dialog.getByRole("button", { name: "Add to .gitignore" }).click();
    await expect(window.locator("gd-change-row", { hasText: ".gitignore" })).toBeVisible();
    await expect(window.locator("gd-change-row", { hasText: "debug.log" })).toBeHidden();
    expect(repository.read(".gitignore")).toBe("/debug.log\n");
  });

  test("amends the last commit without a file it had, which stays in the working tree", async ({ window, repository }) => {
    repository.write("b.txt", "b\n");
    repository.write("c.txt", "c\n");
    repository.git("add", "b.txt", "c.txt");
    repository.git("commit", "-q", "-m", "Add b and c");
    await window.keyboard.press(`${MOD}+4`);
    const amend = window.getByRole("checkbox", { name: "Amend last commit" });
    const message = window.getByRole("textbox", { name: "Commit message" });
    await message.fill("Draft");
    // A draft stays as it is; turning amend off keeps it.
    await amend.check();
    await expect(message).toHaveValue("Draft");
    await amend.uncheck();
    await expect(message).toHaveValue("Draft");
    // An empty box gets the last message, and gets empty again unless it was edited.
    await message.fill("");
    await amend.check();
    await expect(message).toHaveValue("Add b and c");
    await amend.uncheck();
    await expect(message).toHaveValue("");
    await amend.check();
    await expect(message).toHaveValue("Add b and c");
    const staged = window.getByRole("region", { name: "Staged changes" });
    await expect(staged.locator("gd-change-row")).toHaveCount(2);
    const row = staged.locator("gd-change-row", { hasText: "b.txt" });
    await row.hover();
    await row.getByRole("button", { name: "Unstage" }).click();
    await expect(staged.locator("gd-change-row")).toHaveCount(1);
    await window.getByRole("textbox", { name: "Commit message" }).fill("Add c");
    await window.getByRole("button", { name: "Amend" }).click();
    await expect(window.getByRole("checkbox", { name: "Amend last commit" })).not.toBeChecked();
    expect(repository.git("log", "-1", "--format=%s").trim()).toBe("Add c");
    expect(repository.git("ls-tree", "--name-only", "HEAD")).not.toContain("b.txt");
    expect(repository.read("b.txt")).toBe("b\n");
    expect(repository.git("status", "--porcelain")).toContain("?? b.txt");
  });
});
