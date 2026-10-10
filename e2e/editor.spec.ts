import { type Page } from "@playwright/test";
import { expect, FILES, MOD, test } from "./app";

test.use({
  files: {
    ...FILES,
    "src/greet.ts": [
      "export function greet(name: string) {",
      "  const value = `Hello ${name}`;",
      "  console.log(value);",
      "  return value;",
      "}",
      "",
      "export const users = ['ada', 'bob'];",
      "",
    ].join("\n"),
  },
});

async function open(window: Page, path: string) {
  await window.keyboard.press(`${MOD}+3`);
  const tree = window.getByRole("tree", { name: "Files" });
  const [folder, name] = path.split("/") as [string, string];
  await tree.getByText(folder, { exact: true }).click();
  await tree.getByText(name, { exact: true }).click();
  const editor = window.getByRole("textbox", { name: `Contents of ${path}` });
  await editor.click();
  await window.keyboard.press(`${MOD}+Home`);
  return editor;
}

test.describe("code editor", () => {
  test("adds the next occurrences with Ctrl+D and types over all of them", async ({ window, repository }) => {
    const editor = await open(window, "src/greet.ts");
    await window.keyboard.press(`${MOD}+f`);
    const widget = window.getByRole("search", { name: "Find and replace" });
    await widget.getByRole("textbox", { name: "Find" }).fill("value");
    await expect(widget.getByRole("status")).toHaveText("1 of 3");
    await window.keyboard.press("Escape");
    await expect(editor).toBeFocused();
    await window.keyboard.press(`${MOD}+d`);
    await window.keyboard.press(`${MOD}+d`);
    await window.keyboard.type("message");
    await window.keyboard.press(`${MOD}+s`);
    await expect(window.getByLabel("Unsaved changes")).toBeHidden();
    expect(repository.read("src/greet.ts")).toContain("const message = `Hello ${name}`;\n  console.log(message);\n  return message;");
  });

  test("replaces every match of a regular expression, with groups", async ({ window, repository }) => {
    await open(window, "src/greet.ts");
    await window.keyboard.press(isMacOS() ? "Meta+Alt+f" : "Control+h");
    const widget = window.getByRole("search", { name: "Find and replace" });
    await widget.getByRole("button", { name: /^Use regular expression/ }).click();
    await widget.getByRole("textbox", { name: "Find" }).fill("'(\\w+)'");
    await widget.getByRole("textbox", { name: "Replace" }).fill('"$1"');
    await expect(widget.getByRole("status")).toHaveText(/of 2$/);
    await widget.getByRole("button", { name: /^Replace all/ }).click();
    await expect(widget.getByRole("status")).toHaveText("No results");
    await window.keyboard.press(`${MOD}+s`);
    await expect(window.getByLabel("Unsaved changes")).toBeHidden();
    expect(repository.read("src/greet.ts")).toContain(`export const users = ["ada", "bob"];`);
  });

  test("folds a function and a Markdown section", async ({ window }) => {
    const code = await open(window, "src/greet.ts");
    await window.locator(".cm-gutters").hover();
    await window.locator(".cm-foldMarker:visible").first().click();
    await expect(window.locator(".cm-foldPlaceholder")).toBeVisible();
    await expect(code).not.toContainText("console.log");
    await window.locator(".cm-foldPlaceholder").click();
    await expect(code).toContainText("console.log");

    const page = await open(window, "docs/Home.md");
    // Headings fold once the Markdown language has loaded.
    await expect(window.locator(".cm-foldMarker:visible").first()).toBeAttached();
    await window.keyboard.press("Control+Alt+BracketLeft");
    await expect(window.locator(".cm-foldPlaceholder")).toBeVisible();
    await expect(page).toContainText("# Home");
    await expect(page).not.toContainText("## Start");
  });

  test("shows a minimap for code until it is switched off", async ({ window }) => {
    await open(window, "src/greet.ts");
    await expect(window.locator(".cm-minimap")).toBeVisible();
    await window.keyboard.press(`${MOD}+k`);
    await window.getByPlaceholder("Search pages, tasks, files and commands").fill("Toggle minimap");
    await window.keyboard.press("Enter");
    await expect(window.locator(".cm-minimap")).toHaveCount(0);
    await window.keyboard.press(`${MOD}+,`);
    await expect(window.getByRole("checkbox", { name: "Show minimap" })).not.toBeChecked();
  });
});

function isMacOS() {
  return process.platform === "darwin";
}
