import { Injectable, signal } from "@angular/core";

/** A button on a toast, such as "Undo"; choosing it dismisses the toast. */
export interface NotificationAction {
  readonly label: string;
  readonly run: () => unknown;
}

export interface Notification {
  readonly id: number;
  readonly kind: "success" | "error";
  readonly message: string;
  readonly action?: NotificationAction;
}

const VISIBLE = 4;
const SUCCESS_DURATION = 2600;
/** Long enough to read the message and reach the button. */
const ACTION_DURATION = 8000;

/**
 * Toast messages. Successes fade on their own. Errors need reading, so no
 * timer takes them away: they stay until dismissed, or until an operation
 * started after them succeeds, which makes them stale.
 */
@Injectable({ providedIn: "root" })
export class Notifications {
  private next = 0;
  private readonly list = signal<readonly Notification[]>([]);
  readonly visible = this.list.asReadonly();

  success(message: string, action?: NotificationAction): void {
    const id = this.push("success", message, action);
    setTimeout(() => this.dismiss(id), action ? ACTION_DURATION : SUCCESS_DURATION);
  }

  error(error: unknown, action?: NotificationAction): void {
    this.push("error", messageOf(error), action);
  }

  /** Runs a toast's action and dismisses the toast. */
  act(notification: Notification): void {
    this.dismiss(notification.id);
    notification.action?.run();
  }

  /** Marks now, for {@link clearErrors}. */
  mark(): number {
    return this.next;
  }

  /** Takes away the errors shown before `mark`. */
  clearErrors(mark: number): void {
    this.list.update((all) => all.filter((notification) => notification.kind !== "error" || notification.id > mark));
  }

  dismiss(id: number): void {
    this.list.update((all) => all.filter((notification) => notification.id !== id));
  }

  private push(kind: Notification["kind"], message: string, action?: NotificationAction): number {
    const id = ++this.next;
    const notification = { id, kind, message, ...(action ? { action } : {}) };
    this.list.update((all) => [...all.filter((n) => n.message !== message), notification].slice(-VISIBLE));
    return id;
  }
}

export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
