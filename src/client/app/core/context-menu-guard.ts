/**
 * The webview's own context menu treats the app as a web page: its "Share"
 * shares an internal URL. It stays only in fields and editors, where copy
 * and paste are useful, and on selected text, which it copies; items offer
 * their own menus instead (CDK's context menu trigger cancels the event and
 * stops it before it gets here).
 */
import { DestroyRef, Injectable, inject } from "@angular/core";
import { isMac, isTyping } from "./hotkeys";

/** True when `target` holds some of the selected text. */
function inSelection(target: EventTarget | null): boolean {
  const selection = getSelection();
  if (!selection || selection.isCollapsed || !(target instanceof Node)) return false;
  for (let i = 0; i < selection.rangeCount; i++) if (selection.getRangeAt(i).intersectsNode(target)) return true;
  return false;
}

/**
 * Shift+F10 and the context-menu key open the focused item's menu, as a
 * right-click at its centre would. Chromium does this itself except on
 * macOS, where the guard does it. True when it opened one.
 */
export function openMenuFromKeyboard(event: KeyboardEvent, target: EventTarget | null = event.target): boolean {
  const menuKey = event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey);
  if (!menuKey || event.defaultPrevented || !(target instanceof HTMLElement) || isTyping(target)) return false;
  const box = target.getBoundingClientRect();
  const opened = !target.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: box.left + box.width / 2,
      clientY: box.top + box.height / 2,
    }),
  );
  if (opened) event.preventDefault();
  return opened;
}

@Injectable({ providedIn: "root" })
export class ContextMenuGuard {
  constructor() {
    const suppress = (event: MouseEvent) => {
      if (!event.defaultPrevented && !isTyping(event.target) && !inSelection(event.target)) event.preventDefault();
    };
    const keyboard = (event: KeyboardEvent) => void openMenuFromKeyboard(event);
    addEventListener("contextmenu", suppress);
    if (isMac) addEventListener("keydown", keyboard);
    inject(DestroyRef).onDestroy(() => {
      removeEventListener("contextmenu", suppress);
      removeEventListener("keydown", keyboard);
    });
  }
}
