import { TestBed } from "@angular/core/testing";
import type { ContentArea, Storage } from "../../../../contracts/model";
import { openRepository, settle } from "../../testing/component-harness";
import { contentBranch } from "../../testing/fake-platform";
import { SettingsView } from "./settings-view";

async function render(storage?: Storage) {
  const harness = await openRepository(storage ? { storage } : {});
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
    expect(element.querySelector(".content-branch")!.textContent).toMatch(/gitdesk[\s\S]*origin[\s\S]*2 to push/);
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

  it("offers no automatic sync while every area lives in the checkout", async () => {
    const { element } = await render();
    expect(element.querySelector("#setting-autosync")).toBeNull();
    expect(element.querySelector(".content-branch")).toBeNull();
  });
});
