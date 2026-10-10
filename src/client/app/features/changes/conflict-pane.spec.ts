import { TestBed } from "@angular/core/testing";
import type { ConflictFile } from "../../../../contracts/model";
import { openRepository, settle } from "../../testing/component-harness";
import { ConflictPane } from "./conflict-pane";

const TEXT = "start\n<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> feature\nmiddle\n<<<<<<< HEAD\na\n=======\nb\n>>>>>>> feature\n";

async function render(file: ConflictFile) {
  const harness = await openRepository({ changes: [{ path: file.path, index: "U", worktree: "U", conflict: file.kind }] });
  harness.managers.versionControl.conflict.mockResolvedValue(file);
  const fixture = TestBed.createComponent(ConflictPane);
  fixture.componentRef.setInput("path", file.path);
  await settle(fixture);
  const element = fixture.nativeElement as HTMLElement;
  const button = (label: string) =>
    [...element.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent!.trim() === label)!;
  const click = async (label: string) => {
    button(label).click();
    await settle(fixture);
  };
  const editorText = () => [...element.querySelectorAll(".cm-line")].map((line) => line.textContent).join("\n");
  return { ...harness, fixture, element, button, click, editorText };
}

describe("ConflictPane", () => {
  it("resolves hunk by hunk, then stages the result", async () => {
    const { element, click, editorText, managers } = await render({ path: "a.txt", kind: "both-modified", text: TEXT });
    expect(element.querySelector(".conflict-count")!.textContent).toBe("Conflict 1 of 2");
    await click("Accept incoming");
    expect(element.querySelector(".conflict-count")!.textContent).toBe("Conflict 1 of 1");
    await click("Accept both");
    expect(element.querySelector(".conflict-count")!.textContent).toContain("No conflict markers left");
    expect(editorText()).toBe("start\ntheirs\nmiddle\na\nb\n");
    await click("Mark as resolved");
    expect(managers.versionControl.resolveConflict).toHaveBeenCalledWith("w1", "a.txt", {
      use: "text",
      text: "start\ntheirs\nmiddle\na\nb\n",
    });
  });

  it("asks before marking a file with conflict markers as resolved", async () => {
    const { click, dialogs, managers } = await render({ path: "a.txt", kind: "both-modified", text: TEXT });
    dialogs.confirm.mockResolvedValue(false);
    await click("Mark as resolved");
    expect(dialogs.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Conflict markers left" }));
    expect(managers.versionControl.resolveConflict).not.toHaveBeenCalled();
  });

  it("takes a whole side", async () => {
    const { click, managers } = await render({ path: "a.txt", kind: "both-modified", text: TEXT });
    await click("Take current");
    expect(managers.versionControl.resolveConflict).toHaveBeenCalledWith("w1", "a.txt", { use: "ours" });
  });

  it("offers to keep or delete a file the incoming side deleted", async () => {
    const { element, click, managers } = await render({ path: "gone.txt", kind: "deleted-by-them", text: "kept\n" });
    expect(element.querySelector("gd-code-editor")).toBeNull();
    expect(element.textContent).toContain("the incoming side deleted it");
    await click("Delete the file");
    expect(managers.versionControl.resolveConflict).toHaveBeenCalledWith("w1", "gone.txt", { use: "delete" });
  });

  it("offers whole sides for binary files", async () => {
    const { element, click, managers } = await render({ path: "logo.png", kind: "both-modified", text: null });
    expect(element.textContent).toContain("can't merge this file line by line");
    await click("Take incoming");
    expect(managers.versionControl.resolveConflict).toHaveBeenCalledWith("w1", "logo.png", { use: "theirs" });
  });
});
