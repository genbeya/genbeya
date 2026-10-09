import { Injectable, signal } from "@angular/core";

export interface Notification {
  readonly id: number;
  readonly kind: "success" | "error";
  readonly message: string;
}

const VISIBLE = 4;
const SUCCESS_DURATION = 2600;

/** Toast messages. Successes fade on their own; errors stay until dismissed, since they need reading. */
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
