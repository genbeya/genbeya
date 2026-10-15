/**
 * Clones real repositories into the demo, opens them, and opens them again
 * from OPFS after a reload with the network cut off; writes what it
 * measured to test-results-real-repositories/<project>.json.
 */
import { writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const REPOSITORIES = [
  { label: "small", url: "https://wasm-git.petersalomonsen.com/test", relay: false },
  { label: "mid-sized", url: "https://github.com/genbeya/genbeya.git", relay: true },
];

const results: Record<string, unknown>[] = [];

test.afterAll(() => {
  writeFileSync(`test-results-real-repositories/${test.info().project.name}.json`, JSON.stringify(results, null, 2));
});

/** Resolves to the next measurement the dialog logs: `[real-repositories] {…}`, or `[real-repositories] probe {…}`. */
const measured = (page: Page, kind = "") =>
  new Promise<Record<string, unknown>>((resolve) => {
    const prefix = `[real-repositories] ${kind ? `${kind} ` : ""}{`;
    const listen = (message: { text(): string }) => {
      if (!message.text().startsWith(prefix)) return;
      page.off("console", listen);
      resolve(JSON.parse(message.text().slice(prefix.length - 1)) as Record<string, unknown>);
    };
    page.on("console", listen);
  });

async function openDialog(page: Page) {
  await page.getByRole("button", { name: /^Demo/ }).click();
  await page.getByRole("menuitem", { name: /Open a repository from a URL/ }).click();
  await expect(page.getByRole("dialog", { name: "Open a repository from a URL" })).toBeVisible();
}

for (const repository of REPOSITORIES)
  test(`clones the ${repository.label} repository, and reopens it from OPFS after a reload`, async ({ page }) => {
    page.on("pageerror", (error) => console.log("page error:", error.message));
    await page.goto("./?real-repositories");
    await expect(page.locator(".workspace-name")).toHaveText("Pocket Weather", { timeout: 30_000 });

    const probe = measured(page, "probe");
    await openDialog(page);
    const support = await probe;
    const dialog = page.getByRole("dialog", { name: "Open a repository from a URL" });
    await dialog.getByLabel("Repository URL").fill(repository.url);
    if (repository.relay) await dialog.getByLabel("Through a relay").check();
    const cloned = measured(page);
    await dialog.getByRole("button", { name: "Clone and open" }).click();
    const clone = await Promise.race([
      cloned,
      dialog
        .locator(".problem")
        .waitFor({ timeout: 280_000 })
        .then(async () => {
          throw new Error(await dialog.locator(".problem").innerText());
        }),
    ]);
    await expect(page.getByRole("dialog", { name: "Open a repository from a URL" })).toBeHidden();
    await expect(page.locator(".workspace-name")).not.toHaveText("Pocket Weather");
    const name = await page.locator(".workspace-name").innerText();
    await page.getByRole("navigation", { name: "Views" }).getByRole("link", { name: "History" }).click();
    await expect(page.locator(".history-row").first()).toBeVisible();
    const commits = await page.locator(".history-row").count();

    // Again after a reload, with nothing but the page's own origin reachable.
    const origin = new URL(page.url()).origin;
    await page.route(
      (url) => url.origin !== origin,
      (route) => route.abort(),
    );
    await page.goto("./?real-repositories");
    await expect(page.locator(".workspace-name")).toHaveText("Pocket Weather", { timeout: 30_000 });
    await openDialog(page);
    const reopened = measured(page);
    await page
      .getByRole("dialog", { name: "Open a repository from a URL" })
      .getByRole("button", { name: "Open", exact: true })
      .first()
      .click();
    const reopen = await reopened;
    await expect(page.locator(".workspace-name")).toHaveText(name);
    const storage = await page.evaluate(async () => (await navigator.storage.estimate()).usage ?? null);

    results.push({
      repository: repository.url,
      relay: repository.relay,
      support,
      clone,
      reopen,
      opfsUsage: storage,
      workspace: name,
      commits,
    });
  });
