import { Location as BrowserHistory } from "@angular/common";
import { ChangeDetectionStrategy, Component, DestroyRef, inject } from "@angular/core";
import { Router, RouterOutlet } from "@angular/router";
import { hotkey } from "../../core/hotkeys";
import { Session } from "../../core/session";
import { ShellUi } from "./shell-ui";
import { CommitDraft } from "../changes/commit-draft";
import { Sidebar, VIEWS } from "./sidebar";

/** The open repository: sidebar, the routed view, and the shortcuts that work everywhere. */
@Component({
  selector: "gd-shell",
  imports: [Sidebar, RouterOutlet],
  // State that lives as long as the repository is open.
  providers: [CommitDraft],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: "./shell.css",
  template: `
    <gd-sidebar />
    <main class="main" [attr.aria-busy]="session.phase() === 'opening'">
      <router-outlet />
    </main>
  `,
})
export class Shell {
  protected readonly session = inject(Session);

  constructor() {
    const router = inject(Router);
    const history = inject(BrowserHistory);
    const ui = inject(ShellUi);
    // Every repository starts on its wiki.
    void router.navigate(["/wiki"]);

    hotkey(["mod+k", "mod+p"], () => void ui.openPalette());
    hotkey("mod+o", () => void this.session.pick());
    hotkey("?", () => void ui.showHelp());
    hotkey("alt+arrowleft", () => history.back());
    hotkey("alt+arrowright", () => history.forward());
    hotkey(
      VIEWS.map((_, i) => `mod+${i + 1}`),
      (event) => void router.navigate(["/" + VIEWS[Number(event.key) - 1]]),
    );
    hotkey("mod+,", () => void router.navigate(["/settings"]));

    // The mouse's back and forward buttons.
    const mouse = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      event.preventDefault();
      if (event.button === 3) history.back();
      else history.forward();
    };
    addEventListener("mouseup", mouse);
    inject(DestroyRef).onDestroy(() => removeEventListener("mouseup", mouse));
  }
}
