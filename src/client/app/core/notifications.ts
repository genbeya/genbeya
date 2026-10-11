import { Injectable, signal } from "@angular/core";

export interface Notification {
  readonly id: number;
  readonly kind: "success" | "error";
  readonly message: string;
}

const VISIBLE = 4;
const SUCCESS_DURATION = 2600;

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

  success(message: string): void {
    const id = this.push("success", message);
    setTimeout(() => this.dismiss(id), SUCCESS_DURATION);
  }

  error(error: unknown): void {
    this.push("error", messageOf(error));
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

  private push(kind: Notification["kind"], message: string): number {
    const id = ++this.next;
    this.list.update((all) => [...all.filter((n) => n.message !== message), { id, kind, message }].slice(-VISIBLE));
    return id;
  }
}

export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
