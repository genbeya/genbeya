/**
 * The webview's own context menu treats the app as a web page: its "Share"
 * shares an internal URL. It stays only in fields and editors, where copy
 * and paste are useful; items offer their own menus instead.
 */
import { DestroyRef, Injectable, inject } from "@angular/core";
import { isTyping } from "./hotkeys";

@Injectable({ providedIn: "root" })
export class ContextMenuGuard {
  constructor() {
    const suppress = (event: MouseEvent) => {
      if (!isTyping(event.target)) event.preventDefault();
    };
    addEventListener("contextmenu", suppress);
    inject(DestroyRef).onDestroy(() => removeEventListener("contextmenu", suppress));
  }
}
