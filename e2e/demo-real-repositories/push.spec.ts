/**
 * The stretch of the experiment: a commit made in the demo goes back
 * through libgit2 (lg2 add, commit and push in the worker) to a Git server,
 * here `scripts/git-test-server.mjs` on a bare repository made for the test.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

const PORT = 8788;
const MOD = process.platform === "darwin" ? "Meta" : "Control";
let server: ChildProcess;
let folder: string;

/** Git with an identity for this command only, never written to any configuration. */
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Seed",
      GIT_AUTHOR_EMAIL: "seed@example.com",
      GIT_COMMITTER_NAME: "Seed",
      GIT_COMMITTER_EMAIL: "seed@example.com",
    },
  });

test.beforeAll(async () => {
  mkdirSync("test-results-real-repositories", { recursive: true });
  folder = mkdtempSync(path.resolve("test-results-real-repositories/push-"));
  const work = path.join(folder, "work");
  mkdirSync(path.join(work, "docs"), { recursive: true });
  writeFileSync(path.join(work, ".genbeya.yml"), "name: Push Test\ntaskPrefix: PT\n");
  writeFileSync(path.join(work, "docs/Home.md"), "# Push Test\n");
  git(folder, "init", "-q", "-b", "main", "work");
  git(work, "add", ".");
  git(work, "commit", "-q", "-m", "Start");
  git(folder, "clone", "-q", "--bare", "work", "sample.git");
  server = spawn("node", ["scripts/git-test-server.mjs", folder, String(PORT)], { stdio: "inherit" });
  await expect
    .poll(() =>
      fetch(`http://127.0.0.1:${PORT}/sample.git/info/refs?service=git-upload-pack`).then(
        (r) => r.status,
        () => 0,
      ),
    )
    .toBe(200);
});

test.afterAll(() => {
  server?.kill();
  rmSync(folder, { recursive: true, force: true });
});

test("pushes a commit made in the demo through wasm-git", async ({ page }, info) => {
  test.skip(!info.project.name.startsWith("chromium"), "Measured in Chromium");
  await page.goto("./?real-repositories");
  await expect(page.locator(".workspace-name")).toHaveText("Pocket Weather", { timeout: 30_000 });
  await page.getByRole("button", { name: /^Demo/ }).click();
  await page.getByRole("menuitem", { name: /Open a repository from a URL/ }).click();
  const dialog = page.getByRole("dialog", { name: "Open a repository from a URL" });
  await dialog.getByLabel("Repository URL").fill(`http://127.0.0.1:${PORT}/sample.git`);
  await dialog.getByRole("button", { name: "Clone and open" }).click();
  await expect(page.locator(".workspace-name")).toHaveText("Push Test");

  // Edit the home page and commit it.
  await page.keyboard.press("e");
  await expect(page.getByRole("textbox", { name: "Page source" })).toBeFocused();
  await page.keyboard.press(`${MOD}+End`);
  await page.keyboard.type("\nWritten in the browser.\n");
  await page.keyboard.press(`${MOD}+s`);
  await expect(page.getByLabel("Unsaved changes")).toBeHidden();
  await page.keyboard.press("Escape");
  await page.getByRole("navigation", { name: "Views" }).getByRole("link", { name: "Changes" }).click();
  await page.getByRole("button", { name: "Stage all" }).click();
  await page.getByRole("textbox", { name: "Commit message" }).fill("Write in the browser");
  await page.keyboard.press(`${MOD}+Enter`);
  await expect(page.getByText("Working tree clean")).toBeVisible();

  const pushed = new Promise<string>((resolve) =>
    page.on("console", (message) => message.text().startsWith("[real-repositories] push") && resolve(message.text())),
  );
  await page.getByRole("button", { name: /^Demo/ }).click();
  await page.getByRole("menuitem", { name: /Push new commits with wasm-git/ }).click();
  const measurement = JSON.parse((await pushed).slice("[real-repositories] push ".length)) as Record<string, unknown>;
  writeFileSync(`test-results-real-repositories/${info.project.name}-push.json`, JSON.stringify(measurement, null, 2));

  // The server has the commit, made by lg2 as the visitor.
  const log = git(path.join(folder, "sample.git"), "log", "-2", "--format=%s|%an|%ae").trim().split("\n");
  expect(log).toEqual(["Write in the browser|You|you@example.com", "Start|Seed|seed@example.com"]);
  expect(git(path.join(folder, "sample.git"), "show", "main:docs/Home.md")).toBe("# Push Test\n\nWritten in the browser.\n");
  // The demo shows it under Git's ID now.
  const head = git(path.join(folder, "sample.git"), "rev-parse", "main").trim();
  await page.getByRole("navigation", { name: "Views" }).getByRole("link", { name: "History" }).click();
  await page.locator(".history-row", { hasText: "Write in the browser" }).click();
  await expect(page.getByText(head.slice(0, 7)).first()).toBeVisible();
});
