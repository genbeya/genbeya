import { expect, FILES, MOD, test } from "./app";

const filler = Array.from({ length: 60 }, (_, i) => `Paragraph ${i + 1}.\n`).join("\n");

test.use({
  files: {
    ...FILES,
    "docs/Guide.md": `# Guide\n\n${filler}\n## Parts\n\nThe flux capacitor goes here.\n`,
    "tasks/DP-2.md": "---\nid: DP-2\ntitle: Order parts\nstatus: todo\n---\n\nBuy a flux capacitor.\n",
    "src/engine.ts": "export const speed = 88;\n\n// Needs the flux capacitor.\nexport const ready = true;\n",
  },
});

test.describe("search", () => {
  test("finds a word in a page, a task and a code file, and opens each where it occurs", async ({ window }) => {
    const search = async (text: string) => {
      await window.keyboard.press(`${MOD}+Shift+F`);
      const palette = window.getByRole("dialog", { name: "Command palette" });
      await palette.getByRole("combobox").fill(`/${text}`);
      await expect(palette.getByRole("status")).toHaveText("3 matches in 3 files");
      return palette;
    };

    let palette = await search("flux capacitor");
    await expect(palette.locator(".palette-group")).toHaveText(["Wiki", "Tasks", "Code"]);
    await expect(palette.getByRole("option")).toHaveCount(3);
    await expect(palette.getByRole("option").first()).toHaveAccessibleName("Guide, line 125: The flux capacitor goes here.");
    await expect(palette.locator(".palette-item mark").first()).toHaveText("flux capacitor");
    await window.keyboard.press("Enter");
    await expect(window.locator(".document-article").getByRole("heading", { name: "Parts" })).toBeInViewport();

    palette = await search("flux capacitor");
    await palette.getByRole("option", { name: /^DP-2 Order parts, line 7/ }).click();
    await expect(window.getByRole("dialog", { name: "Task DP-2" })).toBeVisible();
    await window.keyboard.press("Escape");

    palette = await search("FLUX CAPACITOR");
    await palette.getByRole("option", { name: /^src\/engine\.ts, line 3/ }).click();
    await expect(window).toHaveURL(/#\/code\?file=src%2Fengine.ts&lines=3/);
    await expect.poll(() => window.evaluate(() => getSelection()?.toString())).toBe("// Needs the flux capacitor.");
  });

  test("finds pages not yet committed, and tells when nothing matches", async ({ window, repository }) => {
    repository.write("docs/Draft.md", "# Draft\n\nAn unpublished idea.\n");
    await window.keyboard.press(`${MOD}+k`);
    const palette = window.getByRole("dialog", { name: "Command palette" });
    await palette.getByRole("combobox").fill("/unpublished");
    await expect(palette.getByRole("option", { name: "Draft, line 3: An unpublished idea." })).toBeVisible();
    await palette.getByRole("combobox").fill("/nowhere to be found");
    await expect(palette.getByText("No matches", { exact: true }).first()).toBeVisible();
  });
});
