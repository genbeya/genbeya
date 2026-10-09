/**
 * The webview must never leave the app: a file dropped on the window or a
 * middle-clicked link would replace or open pages outside it. Electron
 * blocks navigation itself; Tauri and Deno Desktop rely on this.
 */
import { DestroyRef, Injectable, inject } from "@angular/core";

@Injectable({ providedIn: "root" })
export class NavigationGuard {
  constructor() {
    const block = (event: Event) => event.preventDefault();
    const auxclick = (event: Event) => {
      if ((event.target as Element | null)?.closest?.("a[href]")) event.preventDefault();
    };
    addEventListener("dragover", block);
    addEventListener("drop", block);
    addEventListener("auxclick", auxclick);
    inject(DestroyRef).onDestroy(() => {
      removeEventListener("dragover", block);
      removeEventListener("drop", block);
      removeEventListener("auxclick", auxclick);
    });
  }
}
