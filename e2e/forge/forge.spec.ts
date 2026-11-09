/**
 * Genbeya on forges in Chromium. The page is served as genbeya.fyi will serve it (`scripts/serve-forge.mjs`),
 * with a content security policy per address; the forges are answered by the simulated forges of the backend
 * tests, so the tests need no network. A request to any other host fails the test.
 */
import { expect, test as base, type Page } from "@playwright/test";
import { fakeForges, type FakeForges, type FakeRepository } from "../../src/testing/fake-forges";

const MOD = process.platform === "darwin" ? "Meta" : "Control";

const repository: FakeRepository = {
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

/** The same repository on every forge, and a private one on GitHub. */
const REPOSITORIES: FakeRepository[] = [
  repository,
  { ...repository, name: "secret", private: true },
  { ...repository, forge: "gitlab", owner: "acme/space" },
  { ...repository, forge: "codeberg" },
  { ...repository, forge: "bitbucket" },
  { ...repository, forge: "gitea", host: "git.example.com" },
];

interface Fixture {
  github: FakeForges;
  /** Requests to hosts no simulated forge answers. */
  foreign: string[];
}

/** Answers every https request with the simulated forges, as forges do for any origin; other hosts fail. */
async function serveForges(page: Page, forges: FakeForges, foreign: string[] = []) {
  await page.route(/^https:\/\//, async (route) => {
    let response: Response;
    try {
      response = await forges(route.request().url(), { headers: await route.request().allHeaders() });
    } catch {
      foreign.push(route.request().url());
      return route.abort();
    }
    await route.fulfill({
      status: response.status,
      headers: { ...Object.fromEntries(response.headers), "access-control-allow-origin": "*", "access-control-expose-headers": "Link" },
      body: Buffer.from(await response.arrayBuffer()),
    });
  });
}

/** The page, answered for by simulated forges; a request to any other host fails the test. */
const test = base.extend<Fixture>({
  // eslint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from its first parameter.
  github: async ({}, use) => use(fakeForges(REPOSITORIES, { token: "github_pat_1" })),
  // eslint-disable-next-line no-empty-pattern -- as above.
  foreign: async ({}, use) => {
    const foreign: string[] = [];
    await use(foreign);
    expect(foreign).toEqual([]);
  },
  page: async ({ page, github, foreign }, use) => {
    await serveForges(page, github, foreign);
    await use(page);
  },
});

test("says what it requests before it asks GitHub, then opens the wiki and the board with live references", async ({ page, github }) => {
  await page.goto("github/acme/rockets");
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
  await page.goto("github/acme/secret");
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
  await expect(page.getByRole("alert")).toHaveText(
    "Enter a repository as owner/repository, such as genbeya/genbeya, or its address on its forge.",
  );
  await page.getByRole("textbox", { name: "Repository" }).fill("https://github.com/acme/rockets");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/\?forge=github&repo=acme%2Frockets$/);
  await expect(page.getByRole("heading", { level: 1, name: "acme/rockets" })).toBeVisible();
});

test("shows the notice at every address of the page, and requests nothing before the visitor agrees", async ({ page, github }) => {
  for (const address of [
    "github/acme/rockets",
    "github/acme/rockets/",
    "github/acme/rockets/tree/main",
    "github/acme/rockets#/tasks",
    "github/acme/rockets#/code?file=src%2Ffuel.ts",
    "?repo=acme/rockets",
    "?forge=github&repo=acme/rockets&branch=main",
    "gitlab/acme/rockets/-/tree/main?host=gitlab.example.com",
  ]) {
    await page.goto(address);
    await expect(page.getByRole("heading", { level: 1, name: "acme/rockets" }), address).toBeVisible();
    await expect(page.locator("main.gh-start")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Open repository" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Keep it in this browser" })).not.toBeChecked();
    await expect(page.locator("gd-root")).toBeEmpty();
  }
  expect(github.requests).toEqual([]);
});

test("asks nothing of GitHub when the visitor cancels", async ({ page, github }) => {
  await page.goto("github/acme/rockets");
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
  await page.goto("github/acme/rockets");
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
  await expect(page.getByText(/This browser keeps one repository for Genbeya/)).toBeVisible();
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
  await page.goto("github/acme/rockets");
  await page.getByRole("checkbox", { name: "Keep it in this browser" }).check();
  await page.getByRole("button", { name: "Open repository" }).click();
  await expect(page.locator(".workspace-name")).toHaveText("Rockets");

  const other = await context.newPage();
  await serveForges(other, github);
  await other.goto("github/acme/rockets");
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
  await page.goto("github/acme/rockets");
  await page.getByRole("checkbox", { name: "Keep it in this browser" }).check();
  await page.getByRole("button", { name: "Open repository" }).click();
  await expect(page.locator(".workspace-name")).toHaveText("Rockets");

  await page.goto("./");
  await expect(page.getByRole("link", { name: "GitHub: acme/rockets" })).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Delete everything kept" }).click();
  await expect(page.getByRole("link", { name: "GitHub: acme/rockets" })).toHaveCount(0);
  await page.goto("github/acme/rockets");
  await expect(page.getByRole("region", { name: "Kept in this browser" })).toHaveCount(0);
});

const FORGES = [
  {
    path: "gitlab/acme/space/rockets",
    label: "GitLab",
    owner: "acme/space",
    hosts: "gitlab.com",
    web: "https://gitlab.com/acme/space/rockets",
  },
  { path: "codeberg/acme/rockets", label: "Codeberg", owner: "acme", hosts: "codeberg.org", web: "https://codeberg.org/acme/rockets" },
  {
    path: "bitbucket/acme/rockets",
    label: "Bitbucket",
    owner: "acme",
    hosts: "api.bitbucket.org",
    web: "https://bitbucket.org/acme/rockets",
  },
];

for (const forge of FORGES)
  test(`opens a repository on ${forge.label}, with its wiki, board and references`, async ({ page, github }) => {
    await page.goto(forge.path);
    await expect(page.getByText(`Genbeya on ${forge.label}`)).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: `${forge.owner}/rockets` })).toBeVisible();
    await expect(page.getByText(`Your browser asks ${forge.label} for the repository's files, at ${forge.hosts}.`)).toBeVisible();
    await expect(page.getByRole("link", { name: `View on ${forge.label}` })).toHaveAttribute("href", forge.web);
    expect(github.requests).toEqual([]);

    await page.getByRole("button", { name: "Open repository" }).click();
    await expect(page.locator(".workspace-name")).toHaveText("Rockets");
    const task = page.locator(".document-article a.md-ref-task");
    await expect(task.locator(".md-ref-title")).toHaveText("Fuel the rocket");
    await expect(task.locator(".md-ref-state")).toHaveText("Doing");
    await expect(page.locator(".document-article a.md-ref-file")).toHaveText("src/fuel.ts:1");
    await page.getByRole("navigation", { name: "Views" }).getByRole("link", { name: "Tasks" }).click();
    await expect(page.getByRole("region", { name: "Todo" })).toContainText("Paint the fins");
    await page.getByRole("button", { name: new RegExp(`^${forge.label}`) }).click();
    await expect(page.getByRole("menuitem", { name: `Open on ${forge.label}` })).toBeVisible();
    // Only the forge's own hosts were asked.
    const hosts = new Set(github.requests.map((request) => new URL(request.url).host));
    expect([...hosts]).toEqual([forge.hosts]);
  });

test("warns before opening a repository on a server of its own, and asks only that server", async ({ page, github }) => {
  await page.goto("gitea/acme/rockets?host=git.example.com");
  await expect(page.getByRole("heading", { level: 1, name: "acme/rockets" })).toBeVisible();
  await expect(page.getByText("On git.example.com")).toBeVisible();
  await expect(page.getByRole("note")).toHaveText(
    "This address names a server of its own: git.example.com. Genbeya can't tell who runs it. Open the repository, and give it a token, only if you know and trust git.example.com.",
  );
  await expect(page.getByText("Whoever runs git.example.com sees your IP address")).toBeVisible();
  await page.getByText("Private repository?").click();
  await expect(page.getByRole("textbox", { name: "Token for git.example.com" })).toBeVisible();
  expect(github.requests).toEqual([]);

  await page.getByRole("button", { name: "Open repository" }).click();
  await expect(page.locator(".workspace-name")).toHaveText("Rockets");
  await expect(page.getByRole("button", { name: /^Gitea git\.example\.com: acme\/rockets/ })).toBeVisible();
  expect(new Set(github.requests.map((request) => new URL(request.url).host))).toEqual(new Set(["git.example.com"]));
});

test("lets the page connect only to the forge its address names", async ({ page }) => {
  const attempt = (url: string) =>
    page.evaluate(
      (target) =>
        fetch(target).then(
          () => "connected",
          () => "blocked",
        ),
      url,
    );
  const blocked: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy/.test(message.text())) blocked.push(message.text());
  });

  await page.goto("gitlab/acme/space/rockets");
  expect(await attempt("https://api.github.com/repos/acme/rockets")).toBe("blocked");
  expect(await attempt("https://git.example.com/api/v1/repos/acme/rockets")).toBe("blocked");
  expect(await attempt("https://gitlab.com/api/v4/projects/acme%2Fspace%2Frockets")).toBe("connected");

  await page.goto("gitea/acme/rockets?host=git.example.com");
  expect(await attempt("https://gitlab.com/api/v4/projects/acme%2Fspace%2Frockets")).toBe("blocked");
  expect(await attempt("https://git.example.com/api/v1/repos/acme/rockets")).toBe("connected");

  // The start page connects nowhere.
  await page.goto("./");
  expect(await attempt("https://api.github.com/repos/acme/rockets")).toBe("blocked");
  expect(blocked.length).toBeGreaterThanOrEqual(4);
});

test("opens a repository on any forge from the start page, by its address", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("combobox", { name: "Forge" }).selectOption("gitea");
  await page.getByRole("textbox", { name: "Server" }).fill("git.example.com");
  await page.getByRole("textbox", { name: "Repository" }).fill("acme/rockets");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/\?forge=gitea&repo=acme%2Frockets&host=git\.example\.com$/);
  await expect(page.getByRole("note")).toContainText("git.example.com");

  await page.goto("./");
  await page.getByRole("textbox", { name: "Repository" }).fill("https://gitlab.com/acme/space/rockets/-/tree/main");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/\?forge=gitlab&repo=acme%2Fspace%2Frockets&branch=main$/);
  await expect(page.getByRole("heading", { level: 1, name: "acme/space/rockets" })).toBeVisible();
});
