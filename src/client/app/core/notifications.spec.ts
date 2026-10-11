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

  it("takes away the errors shown before a mark, not those after", () => {
    notifications.error("Push failed");
    const mark = notifications.mark();
    notifications.error("Fetch failed");
    notifications.clearErrors(mark);
    expect(notifications.visible().map((n) => n.message)).toEqual(["Fetch failed"]);
  });

  it("keeps a success with an action longer, and dismisses a toast whose action runs", () => {
    const undo = vi.fn();
    notifications.success("Reset main", { label: "Undo", run: undo });
    notifications.error("Push rejected", { label: "Force push…", run: vi.fn() });
    vi.advanceTimersByTime(3000);
    expect(notifications.visible().map((n) => n.action?.label)).toEqual(["Undo", "Force push…"]);
    notifications.act(notifications.visible()[0]!);
    expect(undo).toHaveBeenCalledOnce();
    expect(notifications.visible().map((n) => n.message)).toEqual(["Push rejected"]);
    notifications.success("Reset main", { label: "Undo", run: undo });
    vi.advanceTimersByTime(10_000);
    expect(notifications.visible().map((n) => n.message)).toEqual(["Push rejected"]);
  });

  it("keeps a toast while it is pointed at or has the focus, and its time runs on after", () => {
    notifications.success("Reset main", { label: "Undo", run: vi.fn() });
    const [toast] = notifications.visible();
    vi.advanceTimersByTime(5000);
    notifications.hold(toast!.id, "pointer");
    notifications.hold(toast!.id, "focus");
    vi.advanceTimersByTime(20_000);
    notifications.release(toast!.id, "pointer");
    vi.advanceTimersByTime(20_000);
    expect(notifications.visible()).toHaveLength(1);
    notifications.release(toast!.id, "focus");
    vi.advanceTimersByTime(2900);
    expect(notifications.visible()).toHaveLength(1);
    vi.advanceTimersByTime(200);
    expect(notifications.visible()).toEqual([]);
  });

  it("dismisses on request", () => {
    notifications.error("x");
    notifications.dismiss(notifications.visible()[0]!.id);
    expect(notifications.visible()).toEqual([]);
  });
});
