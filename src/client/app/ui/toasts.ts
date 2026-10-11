import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { Notifications } from "../core/notifications";
import { Icon } from "./icon";

/** Toasts, which stay while pointed at or focused, so their buttons stay within reach (WCAG 2.2.1). */
@Component({
  selector: "gd-toasts",
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="toasts" aria-live="polite">
      @for (toast of notifications.visible(); track toast.id) {
        <div
          class="toast toast-{{ toast.kind }}"
          [attr.role]="toast.kind === 'error' ? 'alert' : 'status'"
          (mouseenter)="notifications.hold(toast.id, 'pointer')"
          (mouseleave)="notifications.release(toast.id, 'pointer')"
          (focusin)="notifications.hold(toast.id, 'focus')"
          (focusout)="left($event, toast.id)"
        >
          @if (toast.kind === "error") {
            <svg gd-icon name="circle-alert" [size]="15"></svg>
          } @else {
            <svg gd-icon name="check" [size]="15"></svg>
          }
          <span class="selectable">{{ toast.message }}</span>
          @if (toast.action; as action) {
            <button type="button" class="toast-action" (click)="notifications.act(toast)">{{ action.label }}</button>
          }
          <button type="button" aria-label="Dismiss" (click)="notifications.dismiss(toast.id)">
            <svg gd-icon name="x" [size]="14"></svg>
          </button>
        </div>
      }
    </div>
  `,
})
export class Toasts {
  protected readonly notifications = inject(Notifications);

  /** The focus left the toast, not just moved between its buttons. */
  protected left(event: FocusEvent, id: number) {
    if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) this.notifications.release(id, "focus");
  }
}
