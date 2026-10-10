/**
 * The webview's own context menu treats the app as a web page: its "Share"
 * shares an internal URL. It stays only in fields and editors, where copy
 * and paste are useful, and on selected text, which it copies; items offer
 * their own menus instead (CDK's context menu trigger cancels the event and
 * stops it before it gets here).
 */
import { DestroyRef, Injectable, inject } from "@angular/core";
import { isTyping } from "./hotkeys";

/** True when `target` holds some of the selected text. */
function inSelection(target: EventTarget | null): boolean {
  const selection = getSelection();
  if (!selection || selection.isCollapsed || !(target instanceof Node)) return false;
  for (let i = 0; i < selection.rangeCount; i++) if (selection.getRangeAt(i).intersectsNode(target)) return true;
  return false;
}

@Injectable({ providedIn: "root" })
export class ContextMenuGuard {
  constructor() {
    const suppress = (event: MouseEvent) => {
      if (!event.defaultPrevented && !isTyping(event.target) && !inSelection(event.target)) event.preventDefault();
    };
    addEventListener("contextmenu", suppress);
    inject(DestroyRef).onDestroy(() => removeEventListener("contextmenu", suppress));
  }
}
