/**
 * Genbeya on GitHub in Chromium. The page is served as genbeya.fyi serves it; GitHub's API and raw files are
 * answered by the simulated GitHub of the backend tests, so the tests need no network. Requests to anywhere but
 * the page's own files and those two hosts fail the test.
 */
import { expect, test as base, type Page } from "@playwright/test";

const MOD = process.platform === "darwin" ? "Meta" : "Control";
import { fakeGitHub, type FakeGitHub } from "../../src/testing/fake-github";

const repository = {
  owner: "acme",
  name: "rockets",
  defaultBranch: "main",
  branches: {
    main: {
      message: "Plan the launch",
      files: {
        ".genbeya.yml": "name: Rockets\ntaskPrefix: RKT\nstatuses: [todo, doing, done]\n",
        "docs/Home.md": "# Rockets\n\nWe launch with [[RKT-1]], see the [[Guide]] and [[src/fuel.ts#L1-L1]].\n",
        "docs/Guide.md": "# Guide\n\nCount down.\n",
        "tasks/RKT-1.md": "---\nid: RKT-1\ntitle: Fuel the rocket\nstatus: doing\n---\n\n- [ ] Order fuel\n",
        "tasks/RKT-2.md": "---\nid: RKT-2\ntitle: Paint the fins\nstatus: todo\n---\n",
        "src/fuel.ts": "export const litres = 1000;\n",
        "src/unused.ts": "export {};\n",
      },
    },
  },
};

const GITHUB = /^https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//;

interface Fixture {
  github: FakeGitHub;
}

/** Answers for GitHub with `github`, as GitHub does for any origin. */
async function serveGitHub(page: Page, github: FakeGitHub) {
  await page.route(GITHUB, async (route) => {
    const response = await github(route.request().url(), { headers: await route.request().allHeaders() });
    await route.fulfill({
      status: response.status,
      headers: { ...Object.fromEntries(response.headers), "access-control-allow-origin": "*" },
      body: Buffer.from(await response.arrayBuffer()),
    });
  });
}

/** The page, answered for by a simulated GitHub; requests to anywhere but the page's own files and GitHub fail the test. */
const test = base.extend<Fixture>({
  // eslint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from its first parameter.
  github: async ({}, use) => use(fakeGitHub([repository, { ...repository, name: "secret", private: true }], { token: "github_pat_1" })),
  page: async ({ page, github, baseURL }, use) => {
    const origin = new URL(baseURL!).origin;
    const foreign: string[] = [];
    page.on("request", (request) => {
      const url = request.url();
      if (!url.startsWith(origin) && !GITHUB.test(url) && !/^(data|blob):/.test(url)) foreign.push(url);
    });
    await serveGitHub(page, github);
    await use(page);
    expect(foreign).toEqual([]);
  },
});

test("says what it requests before it asks GitHub, then opens the wiki and the board with live references", async ({ page, github }) => {
  await page.goto("acme/rockets");
  await expect(page.getByRole("heading", { level: 1, name: "acme/rockets" })).toBeVisible();
  await expect(page.getByText("api.github.com and raw.githubusercontent.com")).toBeVisible();
  await expect(page.getByRole("link", { name: "View on GitHub" })).toHaveAttribute("href", "https://github.com/acme/rockets");
  expect(github.requests).toEqual([]);

  await page.getByRole("button", { name: "Open repository" }).click();
  await expect(page.locator(".workspace-name")).toHaveText("Rockets");
  const article = page.locator(".document-article");
  await expect(article.getByRole("heading", { level: 1, name: "Rockets" })).toBeVisible();
  const task = article.locator("a.md-ref-task");
  await expect(task.locator(".md-ref-title")).toHaveText("Fuel the rocket");
  await expect(task.locator(".md-ref-state")).toHaveText("Doing");
  await expect(article.locator("a.md-ref-page")).toHaveText("Guide");
  await expect(article.locator("a.md-ref-file")).toHaveText("src/fuel.ts:1");

  // Genbeya's content and what it refers to, not the rest of the code.
  const files = github.requests
    .filter((request) => request.url.startsWith("https://raw.githubusercontent.com/"))
    .map((request) => request.url.split("/").slice(6).join("/"));
  expect(files.sort()).toEqual([".genbeya.yml", "docs/Guide.md", "docs/Home.md", "src/fuel.ts", "tasks/RKT-1.md", "tasks/RKT-2.md"]);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length, document.cookie])).toEqual([0, 0, ""]);

  await page.getByRole("navigation", { name: "Views" }).getByRole("link", { name: "Tasks" }).click();
  await expect(page.getByRole("region", { name: "Doing" })).toContainText("Fuel the rocket");
  await expect(page.getByRole("region", { name: "Todo" })).toContainText("Paint the fins");

  await page.getByRole("button", { name: /^GitHub/ }).click();
  await expect(page.getByText(/on acme\/rockets as it was on GitHub: main at [\da-f]{7}\./)).toBeVisible();
  await expect(page.getByText("one other stays on GitHub")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Open on GitHub" })).toBeVisible();
});

test("opens a private repository with a token, which goes only to GitHub's API", async ({ page, github }) => {
  await page.goto("acme/secret");
  await page.getByRole("button", { name: "Open repository" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "GitHub has no public repository acme/secret. A private one opens with a token that can read it.",
  );
  // The token field opens by itself.
  await page.getByRole("textbox", { name: "Token for api.github.com" }).fill("github_pat_1");
  await page.getByRole("button", { name: "Open repository" }).click();
  await expect(page.locator(".workspace-name")).toHaveText("Rockets");
  const sent = github.requests
    .filter((request) => request.headers["authorization"])
    .map((request) => [new URL(request.url).hostname, request.headers["authorization"]]);
  expect(sent.length).toBeGreaterThan(3);
  expect(sent.every(([host, token]) => host === "api.github.com" && token === "Bearer github_pat_1")).toBe(true);
});

test("asks for a repository when the address names none", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("textbox", { name: "Repository" }).fill("acme");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert")).toHaveText("Enter a repository as owner/repository, such as genbeya/genbeya.");
  await page.getByRole("textbox", { name: "Repository" }).fill("https://github.com/acme/rockets");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/github\/acme\/rockets$/);
  await expect(page.getByRole("heading", { level: 1, name: "acme/rockets" })).toBeVisible();
});

test("shows the notice at every address of the page, and requests nothing before the visitor agrees", async ({ page, github }) => {
  for (const address of [
    "acme/rockets",
    "acme/rockets/",
    "acme/rockets/tree/main",
    "acme/rockets#/tasks",
    "acme/rockets#/code?file=src%2Ffuel.ts",
    "./?repo=acme/rockets",
  ]) {
    await page.goto(address);
    await expect(page.getByRole("heading", { level: 1, name: "acme/rockets" }), address).toBeVisible();
    await expect(page.getByRole("button", { name: "Open repository" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Keep it in this browser" })).not.toBeChecked();
    await expect(page.locator("gd-root")).toBeEmpty();
  }
  expect(github.requests).toEqual([]);
});

test("asks nothing of GitHub when the visitor cancels", async ({ page, github }) => {
  await page.goto("acme/rockets");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Nothing was requested" })).toBeVisible();
  expect(github.requests).toEqual([]);
  await page.getByRole("button", { name: "Show the notice again" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "acme/rockets" })).toBeVisible();
  expect(github.requests).toEqual([]);
});

test("keeps the repository with its changes when the visitor chooses, and opens it again without asking GitHub", async ({
  page,
  github,
}) => {
  await page.goto("acme/rockets");
  await page.getByRole("checkbox", { name: "Keep it in this browser" }).check();
  await page.getByRole("button", { name: "Open repository" }).click();
  await expect(page.locator(".workspace-name")).toHaveText("Rockets");

  await page.getByRole("navigation", { name: "Views" }).getByRole("link", { name: "Tasks" }).click();
  await expect(page.getByRole("region", { name: "Todo" })).toBeVisible();
  await page.keyboard.press("c");
  await page.getByRole("textbox", { name: "Task title" }).fill("Count down");
  await page.keyboard.press(`${MOD}+s`);
  await expect(page.getByRole("dialog", { name: "Task RKT-3" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^GitHub/ }).click();
  await expect(page.getByText("It is kept in this browser, and your changes are saved as you go.")).toBeVisible();
  await page.keyboard.press("Escape");
  // Saving waits a moment after a change.
  await page.waitForTimeout(800);

  await page.reload();
  const kept = page.getByRole("region", { name: "Kept in this browser" });
  await expect(kept).toContainText(/Branch main at [\da-f]{7}, saved .+, with your changes\. Opening it asks nothing of GitHub\./);
  await expect(page.getByText(/This browser keeps one repository for Genbeya on GitHub/)).toBeVisible();
  const asked = github.requests.length;
  await kept.getByRole("button", { name: "Open kept copy" }).click();
  await expect(page.locator(".workspace-name")).toHaveText("Rockets");
  await page.getByRole("navigation", { name: "Views" }).getByRole("link", { name: "Tasks" }).click();
  await page.getByRole("radio", { name: "List" }).click();
  await expect(page.locator(".main").getByText("Count down")).toBeVisible();
  expect(github.requests.length).toBe(asked);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length, document.cookie])).toEqual([0, 0, ""]);

  // Deleting the kept copy keeps the tab open, and the next visit starts with nothing kept.
  await page.getByRole("button", { name: /^GitHub/ }).click();
  await page.getByRole("menuitem", { name: "Delete the kept copy" }).click();
  await page.getByRole("dialog", { name: "Delete the kept copy?" }).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Deleted from this browser.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Open repository" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Kept in this browser" })).toHaveCount(0);
});

test("keeps a repository in one tab at a time", async ({ page, github, context }) => {
  await page.goto("acme/rockets");
  await page.getByRole("checkbox", { name: "Keep it in this browser" }).check();
  await page.getByRole("button", { name: "Open repository" }).click();
  await expect(page.locator(".workspace-name")).toHaveText("Rockets");

  const other = await context.newPage();
  await serveGitHub(other, github);
  await other.goto("acme/rockets");
  await other.getByRole("button", { name: "Open kept copy" }).click();
  await expect(other.getByRole("alert")).toHaveText(
    "This repository is open in another tab that keeps it. Close that tab first, or open the repository here without keeping it.",
  );
  // Without keeping, it opens here too.
  await other.getByRole("button", { name: "Read again from GitHub" }).click();
  await expect(other.locator(".workspace-name")).toHaveText("Rockets");
  await other.close();
});

test("deletes everything kept from the start page", async ({ page }) => {
  await page.goto("acme/rockets");
  await page.getByRole("checkbox", { name: "Keep it in this browser" }).check();
  await page.getByRole("button", { name: "Open repository" }).click();
  await expect(page.locator(".workspace-name")).toHaveText("Rockets");

  await page.goto("./");
  await expect(page.getByRole("link", { name: "acme/rockets" })).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Delete everything kept" }).click();
  await expect(page.getByRole("link", { name: "acme/rockets" })).toHaveCount(0);
  await page.goto("acme/rockets");
  await expect(page.getByRole("region", { name: "Kept in this browser" })).toHaveCount(0);
});
