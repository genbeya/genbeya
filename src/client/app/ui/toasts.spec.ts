import { TestBed } from "@angular/core/testing";
import { Notifications } from "../core/notifications";
import { Toasts } from "./toasts";

describe("Toasts", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps a toast with a button while it is pointed at or focused", () => {
    const notifications = TestBed.inject(Notifications);
    const fixture = TestBed.createComponent(Toasts);
    notifications.success("Reset main", { label: "Undo", run: vi.fn() });
    fixture.detectChanges();
    const toast = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(".toast")!;
    toast.dispatchEvent(new MouseEvent("mouseenter"));
    vi.advanceTimersByTime(20_000);
    expect(notifications.visible()).toHaveLength(1);
    toast.querySelector<HTMLButtonElement>(".toast-action")!.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    toast.dispatchEvent(new MouseEvent("mouseleave"));
    vi.advanceTimersByTime(20_000);
    expect(notifications.visible()).toHaveLength(1);
    // Moving between its buttons keeps it; leaving lets its time run out.
    const [action, dismiss] = toast.querySelectorAll("button");
    action!.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: dismiss }));
    vi.advanceTimersByTime(20_000);
    expect(notifications.visible()).toHaveLength(1);
    action!.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }));
    vi.advanceTimersByTime(20_000);
    expect(notifications.visible()).toEqual([]);
  });
});
