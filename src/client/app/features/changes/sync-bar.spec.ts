import { TestBed } from "@angular/core/testing";
import type { Snapshot } from "../../../../contracts/model";
import { openRepository, settle } from "../../testing/component-harness";
import { SyncBar } from "./sync-bar";

async function render(change: Partial<Snapshot>) {
  await openRepository(change);
  const fixture = TestBed.createComponent(SyncBar);
  await settle(fixture);
  const element = fixture.nativeElement as HTMLElement;
  return { element, labels: () => [...element.querySelectorAll("button")].map((button) => button.getAttribute("aria-label")) };
}

describe("SyncBar", () => {
  it("fetches, pulls and pushes with the remote", async () => {
    const { labels } = await render({ remotes: [{ name: "origin", url: "https://example.com/repo.git" }] });
    expect(labels()).toEqual(["Fetch from origin", "Pull from origin", "Push to origin"]);
  });

  it("offers nothing to sync without a remote, and says so", async () => {
    const { element, labels } = await render({ remotes: [] });
    expect(labels()).toEqual([]);
    expect(element.textContent).toContain("no remote");
  });
});
