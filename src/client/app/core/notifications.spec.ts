import { TestBed } from "@angular/core/testing";
import { Notifications } from "./notifications";

describe("Notifications", () => {
  let notifications: Notifications;
  beforeEach(() => {
    vi.useFakeTimers();
    notifications = TestBed.inject(Notifications);
  });
  afterEach(() => vi.useRealTimers());

  it("dismisses successes after a moment and keeps errors", () => {
    notifications.success("Saved");
    notifications.error(new Error("Push failed"));
    expect(notifications.visible().map((n) => n.message)).toEqual(["Saved", "Push failed"]);
    vi.advanceTimersByTime(3000);
    expect(notifications.visible().map((n) => n.message)).toEqual(["Push failed"]);
  });

  it("shows a message once, moving repeats to the end, and at most four at a time", () => {
    for (const message of ["a", "b", "a", "c", "d", "e"]) notifications.error(message);
    expect(notifications.visible().map((n) => n.message)).toEqual(["a", "c", "d", "e"]);
  });

  it("dismisses on request", () => {
    notifications.error("x");
    notifications.dismiss(notifications.visible()[0]!.id);
    expect(notifications.visible()).toEqual([]);
  });
});
