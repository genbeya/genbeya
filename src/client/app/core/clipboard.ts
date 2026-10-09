/** Copying text, with feedback: the clipboard can be missing or refuse. */
import { Injectable, inject } from "@angular/core";
import { Notifications } from "./notifications";

@Injectable({ providedIn: "root" })
export class Clipboard {
  private readonly notifications = inject(Notifications);

  /** Copies `text`; announces "`what` copied" when given. Resolves to whether it worked. */
  async copy(text: string, what?: string): Promise<boolean> {
    try {
      if (!navigator.clipboard) throw new Error("No clipboard.");
      await navigator.clipboard.writeText(text);
    } catch {
      this.notifications.error("Couldn't copy to the clipboard.");
      return false;
    }
    if (what) this.notifications.success(`${what} copied`);
    return true;
  }
}
