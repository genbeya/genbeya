import { TestBed } from "@angular/core/testing";
import type { Task } from "../../../../contracts/model";
import { openRepository, settle } from "../../testing/component-harness";
import { task } from "../../testing/fake-platform";
import { TaskComments } from "./task-comments";

const commented = task("TP-1", {
  comments: [
    { author: "Bob", date: "2026-10-10T14:32+02:00", body: "See **this** and [[TP-1]]." },
    { author: "Ada", date: "2026-10-11T09:05+02:00", body: "Mine" },
  ],
});

async function render(value: Task = commented) {
  const harness = await openRepository({ tasks: [value] });
  harness.managers.content.commentAuthor.mockResolvedValue("Ada");
  const fixture = TestBed.createComponent(TaskComments);
  fixture.componentRef.setInput("task", value);
  const changed: Task[] = [];
  fixture.componentInstance.changed.subscribe((next) => changed.push(next));
  await settle(fixture);
  const element = fixture.nativeElement as HTMLElement;
  const composer = () => element.querySelector<HTMLTextAreaElement>("textarea[aria-label='New comment']")!;
  const type = (field: HTMLTextAreaElement, text: string) => {
    field.value = text;
    field.dispatchEvent(new Event("input"));
  };
  const button = (name: string) =>
    [...element.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === name || b.textContent!.trim() === name)!;
  return { ...harness, fixture, element, changed, composer, type, button };
}

describe("TaskComments", () => {
  it("renders each comment's Markdown with its author and time", async () => {
    const { element } = await render();
    const comments = element.querySelectorAll(".task-comment");
    expect(comments).toHaveLength(2);
    expect(comments[0]!.querySelector(".task-comment-author")!.textContent).toBe("Bob");
    expect(comments[0]!.querySelector("strong")!.textContent).toBe("this");
    expect(comments[0]!.querySelector("time")!.getAttribute("title")).toBe(new Date("2026-10-10T14:32+02:00").toLocaleString());
  });

  it("adds a comment with Ctrl+Enter and reports the saved task", async () => {
    const { composer, type, managers, fixture, changed } = await render();
    const saved = { ...commented, hash: "h2" };
    managers.content.addComment.mockResolvedValue(saved);
    type(composer(), "  ");
    composer().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    await settle(fixture);
    expect(managers.content.addComment).not.toHaveBeenCalled();
    type(composer(), "Hello [[TP-2]]");
    composer().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    await settle(fixture);
    expect(managers.content.addComment).toHaveBeenCalledWith("w1", "tasks/TP-1.md", "Hello [[TP-2]]");
    expect(changed).toEqual([saved]);
    expect(composer().value).toBe("");
  });

  it("offers editing and deleting only on the user's own comments", async () => {
    const { element } = await render();
    const [bob, ada] = element.querySelectorAll(".task-comment");
    expect(bob!.querySelector("button[aria-label='Edit comment']")).toBeNull();
    expect(ada!.querySelector("button[aria-label='Edit comment']")).not.toBeNull();
    expect(ada!.querySelector("button[aria-label='Delete comment']")).not.toBeNull();
  });

  it("edits a comment of the version shown", async () => {
    const { element, button, type, managers, fixture, changed } = await render();
    managers.content.editComment.mockResolvedValue({ ...commented, hash: "h2" });
    button("Edit comment").click();
    await settle(fixture);
    const field = element.querySelector<HTMLTextAreaElement>("textarea[aria-label='Edit comment']")!;
    expect(field.value).toBe("Mine");
    type(field, "Changed");
    button("Save").click();
    await settle(fixture);
    expect(managers.content.editComment).toHaveBeenCalledWith("w1", "tasks/TP-1.md", 1, "Changed", "hash-TP-1");
    expect(changed).toHaveLength(1);
    expect(element.querySelector("textarea[aria-label='Edit comment']")).toBeNull();
  });

  it("deletes a comment after asking", async () => {
    const { button, managers, dialogs, fixture } = await render();
    managers.content.deleteComment.mockResolvedValue(task("TP-1", { hash: "h2" }));
    dialogs.confirm.mockResolvedValueOnce(false);
    button("Delete comment").click();
    await settle(fixture);
    expect(managers.content.deleteComment).not.toHaveBeenCalled();
    button("Delete comment").click();
    await settle(fixture);
    expect(managers.content.deleteComment).toHaveBeenCalledWith("w1", "tasks/TP-1.md", 1, "hash-TP-1");
  });

  it("reports an unsent comment as unsaved", async () => {
    const { composer, type, fixture } = await render(task("TP-1"));
    expect(fixture.componentInstance.dirty()).toBe(false);
    type(composer(), "Draft");
    expect(fixture.componentInstance.dirty()).toBe(true);
  });
});
