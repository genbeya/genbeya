/** The web demo in Chromium: each test loads the page, which starts with a fresh sample project. */
import { expect, test as base, type Page } from "@playwright/test";

const MOD = process.platform === "darwin" ? "Meta" : "Control";
/** The views by their links: browsers keep Ctrl+1 to Ctrl+9 for their tabs. */
const VIEWS = { tasks: "Tasks", changes: "Changes", history: "History" } as const;
const show = (page: Page, view: keyof typeof VIEWS) =>
  page.getByRole("navigation", { name: "Views" }).getByRole("link", { name: VIEWS[view] }).click();

/** The demo's page, open on the sample project; requests to anywhere but the demo's own files fail the test. */
const test = base.extend<{ page: Page }>({
  page: async ({ page, baseURL }, use) => {
    const origin = new URL(baseURL!).origin;
    const foreign: string[] = [];
    page.on("request", (request) => {
      if (!request.url().startsWith(origin) && !/^(data|blob):/.test(request.url())) foreign.push(request.url());
    });
    await page.goto("./");
    await expect(page.locator(".workspace-name")).toHaveText("Pocket Weather");
    await expect(page.locator(".document-article").getByRole("heading", { level: 1, name: "Pocket Weather" })).toBeVisible();
    await use(page);
    expect(foreign).toEqual([]);
  },
});

test("opens the sample project with the tour offer, and keeps nothing in the browser", async ({ page }) => {
  await expect(page.getByRole("region", { name: "New to Genbeya?" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Demo/ })).toBeVisible();
  // Layout choices are remembered in memory only.
  await show(page, "tasks");
  await page.getByRole("radio", { name: "List" }).click();
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length, document.cookie])).toEqual([0, 0, ""]);
  // The terminal can't run in a browser.
  await page.keyboard.press("Control+`");
  await expect(page.getByText("The terminal isn't available in the demo.")).toBeVisible();
});

test("creates a task", async ({ page }) => {
  await show(page, "tasks");
  await expect(page.getByRole("region", { name: "Todo" })).toBeVisible();
  await page.keyboard.press("c");
  await page.getByRole("textbox", { name: "Task title" }).fill("Show wind speed");
  await page.keyboard.press(`${MOD}+s`);
  await expect(page.getByRole("dialog", { name: "Task PW-7" })).toBeVisible();
  await page.keyboard.press("Escape");
  // New tasks wait in the backlog, which the sample's board leaves out; the list shows it.
  await page.getByRole("radio", { name: "List" }).click();
  await expect(page.locator(".main").getByText("Show wind speed")).toBeVisible();
});

test("edits a page with a reference", async ({ page }) => {
  await page.keyboard.press("e");
  const editor = page.getByRole("textbox", { name: "Page source" });
  await expect(editor).toBeFocused();
  await page.keyboard.press(`${MOD}+End`);
  await page.keyboard.type("\nSee [[Forecast so");
  await expect(page.getByRole("option", { name: /Forecast source/ })).toBeVisible();
  // CodeMirror ignores keys for a moment after the list opens.
  await page.waitForTimeout(150);
  await page.keyboard.press("Enter");
  await page.keyboard.press(`${MOD}+s`);
  await expect(page.getByLabel("Unsaved changes")).toBeHidden();
  await page.keyboard.press("Escape");
  await page.locator(".document-article").getByRole("link", { name: "Forecast source" }).last().click();
  await expect(page.locator(".document-article").getByRole("heading", { level: 1, name: "Forecast source" })).toBeVisible();
});

test("stages a hunk and commits it", async ({ page }) => {
  await show(page, "changes");
  await page.locator("gd-change-row", { hasText: "forecast.ts" }).click();
  await page.locator(".cm-hunkBar").first().getByRole("button", { name: "Stage hunk" }).click();
  await expect(page.getByRole("region", { name: "Staged changes" }).locator("gd-change-row", { hasText: "forecast.ts" })).toBeVisible();
  await page.getByRole("textbox", { name: "Commit message" }).fill("Add Thursday to the forecast");
  await page.keyboard.press(`${MOD}+Enter`);
  await expect(page.getByText("Working tree clean")).toBeVisible();
  await show(page, "history");
  await expect(page.locator(".history-row").first()).toContainText("Add Thursday to the forecast");
});

test("merges a branch, resolving its conflict", async ({ page }) => {
  await show(page, "history");
  await page.locator(".history-row", { hasText: "Test the conversion" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Merge fahrenheit into main…" }).click();
  await page.getByRole("dialog", { name: "Merge fahrenheit into main" }).getByRole("button", { name: "Merge" }).click();
  const banner = page.getByRole("region", { name: "Merge in progress" });
  await expect(banner.getByRole("status")).toHaveText(/Merging fahrenheit into main\s+— 1 conflict/);
  await expect(page.getByRole("region", { name: "Conflicts" })).toContainText("README.md");
  await page.getByRole("button", { name: "Accept incoming" }).click();
  await page.getByRole("button", { name: "Mark as resolved" }).click();
  await expect(banner).toContainText("no conflicts left");
  await banner.getByRole("button", { name: "Continue" }).click();
  await expect(banner).toBeHidden();
  await show(page, "history");
  await expect(page.locator(".history-row").first()).toContainText("Merge branch 'fahrenheit'");
});

test("starts over when the demo is reset", async ({ page }) => {
  await show(page, "tasks");
  await expect(page.getByRole("region", { name: "Todo" })).toBeVisible();
  await page.keyboard.press("c");
  await page.getByRole("textbox", { name: "Task title" }).fill("Gone after the reset");
  await page.keyboard.press(`${MOD}+s`);
  await page.keyboard.press("Escape");
  await page.getByRole("radio", { name: "List" }).click();
  await expect(page.locator(".main").getByText("Gone after the reset")).toBeVisible();

  await page.getByRole("button", { name: /^Demo/ }).click();
  await page.getByRole("menuitem", { name: "Reset demo" }).click();
  await page.getByRole("dialog", { name: "Reset the demo?" }).getByRole("button", { name: "Reset demo" }).click();
  await expect(page).toHaveURL(/\/try\/$/);
  await expect(page.locator(".document-article").getByRole("heading", { level: 1, name: "Pocket Weather" })).toBeVisible();
  await show(page, "tasks");
  // The board again: layout choices went with everything else.
  await expect(page.locator("gd-task-card", { hasText: "Show temperatures in Fahrenheit" })).toBeVisible();
  await page.getByRole("radio", { name: "List" }).click();
  await expect(page.locator(".main").getByText("Fetch real forecasts")).toBeVisible();
  await expect(page.locator(".main").getByText("Gone after the reset")).toHaveCount(0);
});
