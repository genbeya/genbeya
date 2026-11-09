/**
 * Genbeya on GitHub in Chromium. The page is served as genbeya.fyi serves it; GitHub's API and raw files are
 * answered by the simulated GitHub of the backend tests, so the tests need no network. Requests to anywhere but
 * the page's own files and those two hosts fail the test.
 */
import { expect, test as base, type Page } from "@playwright/test";
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
  await expect(page.getByText(/on acme\/rockets as it is on GitHub: main at [\da-f]{7}\./)).toBeVisible();
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
  await page.getByRole("textbox", { name: "Token" }).fill("github_pat_1");
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
