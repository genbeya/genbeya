import { TestBed } from "@angular/core/testing";
import type { Change, Operation } from "../../../../contracts/model";
import { openRepository, settle } from "../../testing/component-harness";
import { describeOperation, OperationBanner } from "./operation-banner";

const MERGE: Operation = { kind: "merge", source: "feature", target: "main", step: null, steps: null };
const CONFLICT: Change = { path: "a.txt", index: "U", worktree: "U", conflict: "both-modified" };

async function render(operation: Operation, changes: Change[]) {
  const harness = await openRepository({ operation, changes });
  const fixture = TestBed.createComponent(OperationBanner);
  await settle(fixture);
  const element = fixture.nativeElement as HTMLElement;
  const button = (label: string) => [...element.querySelectorAll<HTMLElement>("button, a")].find((b) => b.textContent!.trim() === label);
  return { ...harness, fixture, element, button };
}

describe("OperationBanner", () => {
  it("names the operation and its conflicts, and waits for them before continuing", async () => {
    const { element, button } = await render(MERGE, [CONFLICT]);
    expect(element.textContent!.replace(/\s+/g, " ").trim()).toContain("Merging feature into main — 1 conflict");
    expect((button("Continue") as HTMLButtonElement).disabled).toBe(true);
    expect(button("Skip")).toBeUndefined();
    expect(button("Resolve")).toBeDefined();
  });

  it("continues once the conflicts are resolved", async () => {
    const { fixture, button, managers } = await render(MERGE, []);
    managers.versionControl.continueOperation.mockResolvedValue("done");
    button("Continue")!.click();
    await settle(fixture);
    expect(managers.versionControl.continueOperation).toHaveBeenCalledWith("w1");
  });

  it("asks before aborting", async () => {
    const { fixture, button, dialogs, managers } = await render(MERGE, [CONFLICT]);
    button("Abort")!.click();
    await settle(fixture);
    expect(dialogs.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Abort merge", danger: true }));
    expect(managers.versionControl.abortOperation).toHaveBeenCalledWith("w1");
  });

  it("lets rebases skip a commit", async () => {
    const { fixture, button, managers } = await render({ kind: "rebase", source: "feature", target: "main", step: 2, steps: 3 }, [
      CONFLICT,
    ]);
    button("Skip")!.click();
    await settle(fixture);
    expect(managers.versionControl.skipOperation).toHaveBeenCalledWith("w1");
  });
});

describe("describeOperation", () => {
  it("names every kind of operation", () => {
    expect(describeOperation({ kind: "rebase", source: "feature", target: "main", step: 2, steps: 5 })).toBe(
      "Rebasing feature onto main (2 of 5)",
    );
    expect(describeOperation({ ...MERGE, kind: "cherry-pick", source: "Fix it" })).toBe("Cherry-picking “Fix it”");
    expect(describeOperation({ ...MERGE, kind: "revert", source: "Fix it" })).toBe("Reverting “Fix it”");
  });
});
