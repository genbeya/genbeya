import type { Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, MOD, savedPreferences, SEEN, sizedWindow, test, VERSION } from "./app";

/** Steps through the tour to its end; resolves to the titles it showed. */
async function takeTour(window: Page): Promise<string[]> {
  const popover = window.locator(".tour-popover");
  const titles: string[] = [];
  for (;;) {
    await expect(popover).toBeVisible();
    const next = popover.getByRole("button", { name: /^(Next|Done)$/ });
    await expect(next).toBeFocused();
    titles.push((await popover.locator("h2").textContent())!);
    const done = (await next.textContent())!.trim() === "Done";
    await next.click();
    if (done) break;
    // The next step may load another view first.
    await expect(popover.locator("h2")).not.toHaveText(titles.at(-1)!);
  }
  await expect(popover).toBeHidden();
  return titles;
}

test.describe("onboarding", () => {
  test.describe("a first start", () => {
    test.use({ preferences: null });

    test("introduces GitDesk, creates the sample project and tours it", async ({ launch, profile }, testInfo) => {
      const parent = testInfo.outputPath("projects");
      mkdirSync(parent, { recursive: true });
      const app = await launch();
      const window = await sizedWindow(app);
      const welcome = window.getByRole("region", { name: "Welcome to GitDesk" });
      await expect(welcome).toBeVisible();

      // The folder dialog is the system's; it answers with the test's folder.
      await app.evaluate(({ dialog }, folder) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
      }, parent);
      await welcome.getByRole("button", { name: "Try GitDesk with a sample project" }).click();
      await expect(window.locator(".workspace-name")).toHaveText("Pocket Weather");
      await expect(window.locator(".document-article").getByRole("heading", { level: 1, name: "Pocket Weather" })).toBeVisible();

      const offer = window.getByRole("region", { name: "New to GitDesk?" });
      await offer.getByRole("button", { name: "Show me around" }).click();
      const titles = await takeTour(window);
      expect(titles).toEqual(expect.arrayContaining(["The wiki", "Write pages", "Tasks", "Changes", "Terminal", "Share"]));
      expect(titles).toHaveLength(15);
      await expect(offer).toBeHidden();

      await expect.poll(() => savedPreferences(profile).tourSeen).toBe(true);
      expect(savedPreferences(profile)).toMatchObject({
        lastSeenVersion: VERSION,
        tourOffered: [`local:${path.join(parent, "gitdesk-sample")}`],
      });
    });
  });

  test.describe("after an update", () => {
    test.use({ preferences: { ...SEEN, lastSeenVersion: "0.2.0" } });

    test("shows what's new once", async ({ window, profile }) => {
      const news = window.getByRole("dialog", { name: /^What's new in GitDesk / });
      await expect(news).toBeVisible();
      await news.getByRole("button", { name: "Got it" }).click();
      await expect(news).toBeHidden();
      await expect.poll(() => savedPreferences(profile).lastSeenVersion).toBe(VERSION);
    });
  });

  test("brings the tour back from the palette, and Escape ends it", async ({ window }) => {
    await expect(window.getByRole("region", { name: "New to GitDesk?" })).toBeHidden();
    await window.keyboard.press(`${MOD}+k`);
    await window.getByRole("dialog", { name: "Command palette" }).getByRole("combobox").fill("start the tour");
    await window.keyboard.press("Enter");
    const popover = window.locator(".tour-popover");
    await expect(popover.locator(".tour-count")).toHaveText("1 of 15");
    await window.keyboard.press("ArrowRight");
    await expect(popover.locator(".tour-count")).toHaveText("2 of 15");
    await window.keyboard.press("Escape");
    await expect(popover).toBeHidden();
  });
});
