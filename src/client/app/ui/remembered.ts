/**
 * Layout choices remembered per device (panel widths, board or list), in
 * the page's local storage unless the platform keeps them elsewhere: the
 * web demo keeps them in memory. Storage can be missing or full; a
 * remembered choice is a convenience, so failures fall back to the default.
 */
import { Injectable, InjectionToken, inject } from "@angular/core";

export type LayoutStorage = Pick<Storage, "getItem" | "setItem">;

export const LAYOUT_STORAGE = new InjectionToken<LayoutStorage | null>("layout storage", {
  providedIn: "root",
  factory: () => {
    try {
      return localStorage;
    } catch {
      return null;
    }
  },
});

@Injectable({ providedIn: "root" })
export class Remembered {
  private readonly storage = inject(LAYOUT_STORAGE);

  recall(key: string): string | null {
    try {
      return this.storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  remember(key: string, value: string): void {
    try {
      this.storage?.setItem(key, value);
    } catch {
      // Not remembered this time.
    }
  }
}
