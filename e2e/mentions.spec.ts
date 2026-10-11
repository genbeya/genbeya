import { expect, FILES, MOD, test } from "./app";

test.use({
  files: {
    ...FILES,
    ".gitdesk.yml": "name: Demo Project\ntaskPrefix: DP\npeople:\n  - handle: ada\n    name: Ada Lovelace\n    email: ada@example.com\n",
    "docs/Home.md": "# Home\n\nPlan:\n\n- [ ] Pay the invoice 2000-01-03\n- [x] Send the offer 2000-01-02\n",
    "tasks/DP-1.md": "---\nid: DP-1\ntitle: First task\nstatus: todo\nassignee: Ada Lovelace\n---\n",
    "tasks/DP-2.md": "---\nid: DP-2\ntitle: Second task\nstatus: todo\n---\n",
  },
});

test.describe("mentions and dates", () => {
  test("mention a person picked while typing @, and show their tasks from the mention", async ({ window, repository }) => {
    await expect(window.locator(".document-article").getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    await window.keyboard.press("e");
    const editor = window.getByRole("textbox", { name: "Page source" });
    await expect(editor).toBeFocused();
    await window.keyboard.press(`${MOD}+End`);
    await window.keyboard.type("\nAsk @Ada");
    await expect(window.getByRole("option", { name: /Ada Lovelace/ })).toBeVisible();
    // CodeMirror ignores keys for a moment after the list opens, so a quick Enter cannot pick by accident.
    await window.waitForTimeout(150);
    await window.keyboard.press("Enter");
    await expect(editor).toContainText("Ask @ada");
    await window.keyboard.press(`${MOD}+s`);
    await expect(window.getByLabel("Unsaved changes")).toBeHidden();
    expect(repository.read("docs/Home.md")).toContain("Ask @ada");
    await window.keyboard.press("Escape");

    const mention = window.locator(".document-article a.md-mention");
    await expect(mention).toContainText("Ada Lovelace");
    await expect(mention).toHaveAttribute("title", "Ada Lovelace <ada@example.com>");
    await mention.click();
    const popover = window.getByRole("dialog", { name: "Ada Lovelace" });
    await expect(popover).toContainText("@ada");
    await expect(popover).toContainText("ada@example.com");
    await popover.getByRole("button", { name: /Tasks assigned to Ada/ }).click();
    await expect(window).toHaveURL(/#\/tasks/);
    await expect(window.getByRole("button", { name: "Remove filter Ada Lovelace" })).toBeVisible();
    await expect(window.locator("gd-task-card")).toHaveCount(1);
    await expect(window.locator("gd-task-card")).toContainText("First task");
  });

  test("insert a date picked while typing //, shown in the user's language", async ({ window, repository }) => {
    await expect(window.locator(".document-article").getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    await window.keyboard.press("e");
    const editor = window.getByRole("textbox", { name: "Page source" });
    await expect(editor).toBeFocused();
    await window.keyboard.press(`${MOD}+End`);
    await window.keyboard.type("\nDue //tomorrow");
    await expect(window.getByRole("option", { name: /^Tomorrow/ })).toBeVisible();
    await window.waitForTimeout(150);
    await window.keyboard.press("Enter");
    const tomorrow = await window.evaluate(() => {
      const date = new Date();
      date.setDate(date.getDate() + 1);
      const day = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
      return {
        iso: new Date(day).toISOString().slice(0, 10),
        text: new Intl.DateTimeFormat(undefined, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(day),
      };
    });
    await expect(editor).toContainText(`Due ${tomorrow.iso}`);
    await window.keyboard.press(`${MOD}+s`);
    await expect(window.getByLabel("Unsaved changes")).toBeHidden();
    expect(repository.read("docs/Home.md")).toContain(`Due ${tomorrow.iso}`);
    await window.keyboard.press("Escape");
    await expect(window.locator(".document-article p .md-date")).toHaveText(tomorrow.text);
    await expect(window.locator(".document-article p .md-date")).toHaveAttribute("title", "tomorrow");
  });

  test("show an open checklist item's passed date as overdue, in red", async ({ window }) => {
    const items = window.locator(".document-article li .md-date");
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toHaveClass(/is-overdue/);
    await expect(items.nth(0)).toHaveAttribute("title", /overdue$/);
    await expect(items.nth(1)).not.toHaveClass(/is-overdue/);
    const [color, red] = await items.nth(0).evaluate((date) => {
      const probe = document.createElement("span");
      probe.style.color = "var(--red)";
      document.body.append(probe);
      const colors = [getComputedStyle(date).color, getComputedStyle(probe).color];
      probe.remove();
      return colors;
    });
    expect(color).toBe(red);
  });
});
