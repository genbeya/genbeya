import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { LucideCircleAlert, LucideCheck, LucideX } from "@lucide/angular";
import { Notifications } from "../core/notifications";

@Component({
  selector: "gd-toasts",
  imports: [LucideCircleAlert, LucideCheck, LucideX],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="toasts" aria-live="polite">
      @for (toast of notifications.visible(); track toast.id) {
        <div class="toast toast-{{ toast.kind }}" [attr.role]="toast.kind === 'error' ? 'alert' : 'status'">
          @if (toast.kind === "error") {
            <svg lucideCircleAlert [size]="15" aria-hidden="true"></svg>
          } @else {
            <svg lucideCheck [size]="15" aria-hidden="true"></svg>
          }
          <span class="selectable">{{ toast.message }}</span>
          <button type="button" aria-label="Dismiss" (click)="notifications.dismiss(toast.id)">
            <svg lucideX [size]="14" aria-hidden="true"></svg>
          </button>
        </div>
      }
    </div>
  `,
})
export class Toasts {
  protected readonly notifications = inject(Notifications);
}
