import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, MOD, test, type Repository } from "./app";

const remotes: string[] = [];

/** A bare repository as the repository's origin, with main pushed and tracked; runs git in it. */
function addOrigin(repository: Repository): (...args: string[]) => string {
  const remote = mkdtempSync(path.join(tmpdir(), "genbeya-e2e-remote-"));
  remotes.push(remote);
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
  repository.git("remote", "add", "origin", remote);
  repository.git("push", "-q", "--set-upstream", "origin", "main");
  return (...args) => execFileSync("git", ["--git-dir", remote, ...args], { encoding: "utf8" });
}

test.afterEach(() => {
  for (const remote of remotes.splice(0)) rmSync(remote, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

test.describe("resetting and pushing", () => {
  test("resets main hard to the previous commit from the history", async ({ window, repository }) => {
    repository.write("src/index.ts", "export const value = 2;\n");
    repository.git("commit", "-qam", "Second");
    repository.write("docs/Guide.md", "# Guide\n\nEdited.\n");

    await window.keyboard.press(`${MOD}+5`);
    await window.locator(".history-row", { hasText: "Initial commit" }).click({ button: "right" });
    await window.getByRole("menuitem", { name: "Reset main to here…" }).click();
    const dialog = window.getByRole("dialog", { name: "Reset main" });
    await expect(dialog).toContainText("1 commit leaves main");
    await dialog.getByRole("radio", { name: /^Hard/ }).check();
    await expect(dialog).toContainText("Your uncommitted changes to 1 file are lost: docs/Guide.md.");
    const reset = dialog.getByRole("button", { name: "Reset", exact: true });
    await expect(reset).toBeDisabled();
    await dialog.getByRole("checkbox", { name: "Discard my uncommitted changes" }).check();
    await reset.click();

    await expect(window.getByRole("status").filter({ hasText: "Reset main to" })).toBeVisible();
    expect(repository.read("src/index.ts")).toBe("export const value = 1;\n");
    expect(repository.read("docs/Guide.md")).toBe("# Guide\n\nHow it works.\n");
    expect(repository.git("log", "--format=%s")).toBe("Initial commit\n");
    await expect(window.locator(".history-row")).toHaveCount(1);
  });

  test("publishes a new branch and tracks it", async ({ window, repository }) => {
    const remote = addOrigin(repository);
    repository.git("switch", "-q", "--create", "feature");
    repository.write("feature.txt", "feature");
    repository.git("add", ".");
    repository.git("commit", "-q", "-m", "Feature");

    await window.keyboard.press(`${MOD}+4`);
    const bar = window.locator("gd-sync-bar");
    await expect(bar).toContainText("no upstream on origin");
    await bar.locator('button[title="Push feature to origin and track it there"]').click();

    await expect(bar).toContainText("origin/feature");
    await expect(bar.getByRole("button", { name: "Push to origin" })).toBeVisible();
    expect(remote("rev-parse", "feature")).toBe(repository.git("rev-parse", "HEAD"));
    expect(repository.git("config", "branch.feature.merge").trim()).toBe("refs/heads/feature");
  });

  test("force pushes an amended commit with a lease once a normal push is rejected", async ({ window, repository }) => {
    const remote = addOrigin(repository);

    await window.keyboard.press(`${MOD}+4`);
    const bar = window.locator("gd-sync-bar");
    await expect(bar).toContainText("origin/main");
    await window.getByRole("checkbox", { name: "Amend last commit" }).check();
    const message = window.getByRole("textbox", { name: "Commit message" });
    await expect(message).toHaveValue("Initial commit");
    await message.fill("Initial commit, amended");
    await window.keyboard.press(`${MOD}+Enter`);
    await expect(bar.getByLabel("1 behind")).toBeVisible();

    await bar.getByRole("button", { name: "Push to origin" }).click();
    const rejection = window.getByRole("alert").filter({ hasText: "the push was rejected" });
    await rejection.getByRole("button", { name: "Force push with lease…" }).click();

    const dialog = window.getByRole("dialog", { name: "Force push to origin/main" });
    await expect(dialog.getByRole("list", { name: "Commits the remote branch loses" })).toContainText("Initial commit");
    const force = dialog.getByRole("button", { name: "Force push" });
    await expect(force).toBeDisabled();
    await dialog.getByRole("checkbox", { name: /I know/ }).check();
    await force.click();

    await expect(window.getByRole("status").filter({ hasText: "Force pushed main to origin/main" })).toBeVisible();
    expect(remote("log", "-1", "--format=%s", "main").trim()).toBe("Initial commit, amended");
    await expect(bar.getByLabel("1 behind")).toBeHidden();
  });
});
