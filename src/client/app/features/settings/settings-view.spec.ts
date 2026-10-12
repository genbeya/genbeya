import { TestBed } from "@angular/core/testing";
import type { ContentArea, Snapshot, Storage } from "../../../../contracts/model";
import { Notifications } from "../../core/notifications";
import { openRepository, settle } from "../../testing/component-harness";
import { contentBranch } from "../../testing/fake-platform";
import { SettingsView } from "./settings-view";

async function render(storage?: Storage, change: Partial<Snapshot> = {}) {
  const harness = await openRepository({ ...(storage ? { storage } : {}), ...change });
  const fixture = TestBed.createComponent(SettingsView);
  await settle(fixture);
  const element = fixture.nativeElement as HTMLElement;
  const choice = (area: ContentArea, label: string) =>
    [...element.querySelectorAll<HTMLButtonElement>(`[aria-labelledby="storage-${area}"] [role=radio]`)].find(
      (button) => button.textContent!.trim() === label,
    )!;
  return { ...harness, fixture, element, choice };
}

describe("SettingsView", () => {
  it("shows where each area lives", async () => {
    const { choice, element } = await render(contentBranch(["tasks"], { ahead: 2 }));
    expect(choice("wiki", "Checkout").getAttribute("aria-checked")).toBe("true");
    expect(choice("tasks", "Content branch").getAttribute("aria-checked")).toBe("true");
    expect(choice("settings", "Content branch").getAttribute("aria-checked")).toBe("false");
    expect(element.querySelector(".content-branch")!.textContent).toMatch(/genbeya[\s\S]*origin[\s\S]*2 to push/);
    expect(element.querySelector("#setting-autosync")).not.toBeNull();
  });

  it("moves one area after the user confirms", async () => {
    const { choice, managers, dialogs, fixture } = await render();
    choice("tasks", "Content branch").click();
    await settle(fixture);
    expect(dialogs.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Keep tasks on the content branch" }));
    expect(managers.content.setStorage).toHaveBeenCalledWith("w1", "tasks", "branch");
  });

  it("leaves the area where it is when it lives there already or the user declines", async () => {
    const { choice, managers, dialogs, fixture, element } = await render(contentBranch(["wiki"]));
    choice("wiki", "Content branch").click();
    dialogs.confirm.mockResolvedValue(false);
    choice("wiki", "Checkout").click();
    await settle(fixture);
    expect(dialogs.confirm).toHaveBeenCalledOnce();
    expect(dialogs.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Keep the wiki in the checkout" }));
    expect(managers.content.setStorage).not.toHaveBeenCalled();
    expect(element.querySelector("#setting-autosync")).not.toBeNull();
  });

  it("opens a type's template in the code view while the tasks live in the checkout", async () => {
    const { element, managers, router, fixture } = await render();
    const navigate = vi.spyOn(router, "navigate").mockResolvedValue(true);
    managers.content.ensureTaskTemplate.mockResolvedValue("tasks/.templates/bug.md");
    element.querySelector<HTMLButtonElement>("button[aria-label='Edit the bug template']")!.click();
    await settle(fixture);
    expect(managers.content.ensureTaskTemplate).toHaveBeenCalledWith("w1", "bug");
    expect(navigate).toHaveBeenCalledWith(["/code"], { queryParams: { file: "tasks/.templates/bug.md" } });
  });

  it("names a type's template on the content branch instead of opening the checkout's file", async () => {
    const { element, managers, router, dialogs, fixture } = await render(contentBranch(["tasks"]));
    const navigate = vi.spyOn(router, "navigate").mockResolvedValue(true);
    managers.content.ensureTaskTemplate.mockResolvedValue("tasks/.templates/bug.md");
    dialogs.confirm.mockResolvedValue(false);
    element.querySelector<HTMLButtonElement>("button[aria-label='Edit the bug template']")!.click();
    await settle(fixture);
    expect(dialogs.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("tasks/.templates/bug.md is on the genbeya branch"),
        confirm: "Copy path",
      }),
    );
    expect(navigate).not.toHaveBeenCalledWith(["/code"], expect.anything());
  });

  it("names the settings file and offers nothing to rename in a repository Genbeya set up", async () => {
    const { element } = await render();
    expect(element.querySelector(".settings-note")!.textContent).toContain("Shared with everyone through .genbeya.yml.");
    expect(element.querySelector(".legacy-files")).toBeNull();
    expect(element.querySelector(".settings-warning")).toBeNull();
  });

  it("offers to rename .gitdesk.yml in the checkout, as a change to commit", async () => {
    const { element, managers, fixture } = await render(undefined, { settingsFile: ".gitdesk.yml", legacyFiles: [".gitdesk.yml"] });
    const success = vi.spyOn(TestBed.inject(Notifications), "success");
    expect(element.querySelector(".settings-note")!.textContent).toContain("Shared with everyone through .gitdesk.yml.");
    const card = element.querySelector(".legacy-files")!;
    expect(card.textContent).toMatch(/Named for GitDesk[\s\S]*reads its files as they are: \.gitdesk\.yml\./);
    const button = card.querySelector<HTMLButtonElement>("button")!;
    expect(button.textContent!.trim()).toBe("Rename to .genbeya.yml");
    button.click();
    await settle(fixture);
    expect(managers.content.renameLegacyFiles).toHaveBeenCalledWith("w1");
    expect(success).toHaveBeenCalledWith("Renamed. Commit the rename in Changes.");
  });

  it("offers to rename the files GitDesk named on the content branch", async () => {
    const { element } = await render(contentBranch(["settings"]), {
      settingsFile: ".gitdesk.yml",
      legacyFiles: [".gitdesk.yml", ".gitdesk-content"],
    });
    expect(element.querySelector(".legacy-files")!.textContent).toContain(
      "reads its files as they are: .gitdesk.yml and .gitdesk-content on the genbeya branch.",
    );
    expect(element.querySelector(".legacy-files button")!.textContent!.trim()).toBe("Rename to .genbeya.yml");
  });

  it("warns about a .gitdesk.yml left over next to .genbeya.yml", async () => {
    const { element } = await render(undefined, { leftoverSettingsFile: ".gitdesk.yml" });
    expect(element.querySelector(".settings-warning")!.textContent).toMatch(
      /\.gitdesk\.yml is left over from GitDesk: Genbeya reads \.genbeya\.yml instead\./,
    );
    expect(element.querySelector(".legacy-files")).toBeNull();
  });

  it("offers no automatic sync while every area lives in the checkout", async () => {
    const { element } = await render();
    expect(element.querySelector("#setting-autosync")).toBeNull();
    expect(element.querySelector(".content-branch")).toBeNull();
  });
});
