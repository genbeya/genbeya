/**
 * Keyboard shortcuts. "mod" is Ctrl, or Cmd on macOS. Single-key shortcuts
 * ("e", "c", "/") never fire while the user types; Escape always does. The
 * most recent registration wins, so an open panel's Escape beats the page's.
 * While a dialog or menu is open, it owns the keyboard.
 */
import { Dialog } from "@angular/cdk/dialog";
import { DestroyRef, Injectable, inject, type Signal } from "@angular/core";

interface Combo {
  readonly key: string;
  readonly mod: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
}

interface Registration {
  readonly combos: readonly Combo[];
  readonly handler: (event: KeyboardEvent) => void;
  readonly enabled: () => boolean;
}

export const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
export const MOD_KEY = isMac ? "⌘" : "Ctrl";

function parse(text: string): Combo {
  const parts = text.toLowerCase().split("+");
  return { key: parts.at(-1)!, mod: parts.includes("mod"), alt: parts.includes("alt"), shift: parts.includes("shift") };
}

/** True when keys typed at `target` belong to a field or an editor. */
export const isTyping = (target: EventTarget | null): boolean =>
  !!(target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable=true], [contenteditable=''], .cm-editor");

function matches(combo: Combo, event: KeyboardEvent): boolean {
  if (combo.mod !== (isMac ? event.metaKey : event.ctrlKey) || combo.alt !== event.altKey) return false;
  if (combo.key !== event.key.toLowerCase()) return false;
  // Letters, digits and named keys match Shift exactly. Symbols take whatever Shift the layout needs ("/" is Shift+7 in Switzerland).
  const exactShift = combo.key.length > 1 || /^[a-z0-9]$/.test(combo.key);
  if (exactShift && combo.shift !== event.shiftKey) return false;
  return combo.mod || combo.alt || combo.key === "escape" || !isTyping(event.target);
}

@Injectable({ providedIn: "root" })
export class Hotkeys {
  private readonly registrations: Registration[] = [];
  private readonly dialog = inject(Dialog);

  constructor() {
    const listener = (event: KeyboardEvent) => this.dispatch(event);
    addEventListener("keydown", listener);
    inject(DestroyRef).onDestroy(() => removeEventListener("keydown", listener));
  }

  /** Registers `combo` (or several) until the returned function is called. */
  register(combo: string | readonly string[], handler: (event: KeyboardEvent) => void, enabled: () => boolean = () => true): () => void {
    const registration: Registration = { combos: (typeof combo === "string" ? [combo] : combo).map(parse), handler, enabled };
    this.registrations.push(registration);
    return () => {
      const index = this.registrations.indexOf(registration);
      if (index >= 0) this.registrations.splice(index, 1);
    };
  }

  private dispatch(event: KeyboardEvent) {
    if (event.defaultPrevented || this.dialog.openDialogs.length > 0) return;
    if ((event.target as HTMLElement | null)?.closest?.(".cdk-overlay-container")) return;
    for (let i = this.registrations.length - 1; i >= 0; i--) {
      const registration = this.registrations[i]!;
      if (!registration.enabled() || !registration.combos.some((combo) => matches(combo, event))) continue;
      event.preventDefault();
      registration.handler(event);
      return;
    }
  }
}

/** Registers a shortcut for the lifetime of the calling component or service. */
export function hotkey(combo: string | readonly string[], handler: (event: KeyboardEvent) => void, enabled?: Signal<boolean>): void {
  const unregister = inject(Hotkeys).register(combo, handler, enabled);
  inject(DestroyRef).onDestroy(unregister);
}
