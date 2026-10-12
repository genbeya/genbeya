import { expect, FILES, MOD, test } from "./app";

/** The files of a repository GitDesk, as Genbeya was called before 0.5, set up: settings in `.gitdesk.yml`. */
const GITDESK_FILES = {
  ...Object.fromEntries(Object.entries(FILES).filter(([file]) => file !== ".genbeya.yml")),
  ".gitdesk.yml": "# Shared with the team\nname: Old Project\ntaskPrefix: DP\n",
};

test.describe("a repository GitDesk set up", () => {
  test.use({ files: GITDESK_FILES });

  test("opens with its settings from .gitdesk.yml and saves them there", async ({ window, repository }) => {
    await expect(window.locator(".workspace-name")).toHaveText("Old Project");
    await window.keyboard.press(`${MOD}+,`);
    await expect(window.getByText("Shared with everyone through .gitdesk.yml.")).toBeVisible();
    await expect(window.getByLabel("Task ID prefix")).toHaveValue("DP");
    await window.getByLabel("Name", { exact: true }).fill("Kept Project");
    await window.getByRole("button", { name: /Save changes/ }).click();
    await expect.poll(() => repository.read(".gitdesk.yml")).toContain("name: Kept Project");
    expect(repository.read(".gitdesk.yml")).toContain("# Shared with the team");
    expect(repository.read(".genbeya.yml")).toBeNull();
  });

  test("renames .gitdesk.yml to .genbeya.yml from Settings, as a change to commit", async ({ window, repository }) => {
    await window.keyboard.press(`${MOD}+,`);
    const legacy = window.locator(".legacy-files");
    await expect(legacy).toContainText("reads its files as they are: .gitdesk.yml.");
    await legacy.getByRole("button", { name: "Rename to .genbeya.yml" }).click();
    await expect(window.getByText("Shared with everyone through .genbeya.yml.")).toBeVisible();
    await expect(legacy).toBeHidden();
    expect(repository.read(".gitdesk.yml")).toBeNull();
    expect(repository.read(".genbeya.yml")).toContain("name: Old Project");
    expect(repository.git("status", "--porcelain").trim()).toBe("R  .gitdesk.yml -> .genbeya.yml");
    await expect(window.locator(".workspace-name")).toHaveText("Old Project");
  });
});

test.describe("a repository with both settings files", () => {
  test.use({ files: { ...FILES, ".gitdesk.yml": "name: Old Project\n" } });

  test("reads .genbeya.yml and warns about the leftover", async ({ window }) => {
    await expect(window.locator(".workspace-name")).toHaveText("Demo Project");
    await window.keyboard.press(`${MOD}+,`);
    await expect(window.locator(".settings-warning")).toContainText(".gitdesk.yml is left over from GitDesk");
  });
});
