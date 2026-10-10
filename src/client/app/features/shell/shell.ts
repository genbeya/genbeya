import { Location as BrowserHistory } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  InjectionToken,
  type Type,
  viewChild,
  ViewContainerRef,
} from "@angular/core";
import { Router, RouterOutlet } from "@angular/router";
import { hotkey } from "../../core/hotkeys";
import { messageOf, Notifications } from "../../core/notifications";
import { Session } from "../../core/session";
import { Terminals, TOGGLE_TERMINAL } from "../../core/terminals";
import { ShellUi } from "./shell-ui";
import { CommitDraft } from "../changes/commit-draft";
import { Sidebar, VIEWS } from "./sidebar";

/** Loads the terminal panel, with xterm.js; a separate chunk, since many never open a terminal. */
export const TERMINAL_PANEL = new InjectionToken<() => Promise<Type<unknown>>>("terminal panel", {
  providedIn: "root",
  factory: () => () => import("../terminal/terminal-panel").then(({ TerminalPanel }) => TerminalPanel),
});

/** The open repository: sidebar, the routed view, the terminal panel, and the shortcuts that work everywhere. */
@Component({
  selector: "gd-shell",
  imports: [Sidebar, RouterOutlet],
  // State that lives as long as the repository is open.
  providers: [CommitDraft],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: "./shell.css",
  template: `
    <gd-sidebar />
    <div class="workspace">
      <main class="main" [attr.aria-busy]="session.phase() === 'opening'">
        <router-outlet />
      </main>
      <ng-container #terminalPanel />
    </div>
  `,
})
export class Shell {
  protected readonly session = inject(Session);
  private readonly terminals = inject(Terminals);
  private readonly terminalPanel = viewChild.required("terminalPanel", { read: ViewContainerRef });

  constructor() {
    const router = inject(Router);
    const history = inject(BrowserHistory);
    const ui = inject(ShellUi);
    const notifications = inject(Notifications);
    const loadTerminalPanel = inject(TERMINAL_PANEL);
    const destroyRef = inject(DestroyRef);
    // Every repository starts on its wiki.
    void router.navigate(["/wiki"]);

    hotkey(["mod+k", "mod+p"], () => void ui.openPalette());
    hotkey("mod+shift+f", () => void ui.openPalette("search"));
    hotkey("mod+o", () => void this.session.pick());
    hotkey("?", () => void ui.showHelp());
    hotkey("alt+arrowleft", () => history.back());
    hotkey("alt+arrowright", () => history.forward());
    hotkey(
      VIEWS.map((_, i) => `mod+${i + 1}`),
      (event) => void router.navigate(["/" + VIEWS[Number(event.key) - 1]]),
    );
    hotkey("mod+,", () => void router.navigate(["/settings"]));
    hotkey(TOGGLE_TERMINAL, () => void this.terminals.toggle());
    // The panel, with xterm.js, loads when a terminal is first wanted; then it stays, shown or hidden, for every view.
    // A failed load (an updated app without the old chunk, say) is reported, and the next toggle tries again.
    let loading = false;
    effect(() => {
      if (!this.terminals.shown() || loading) return;
      loading = true;
      loadTerminalPanel().then(
        (panel) => {
          // The repository may have closed meanwhile.
          if (!destroyRef.destroyed) this.terminalPanel().createComponent(panel);
        },
        (error: unknown) => {
          loading = false;
          this.terminals.shown.set(false);
          notifications.error(`The terminal could not load: ${messageOf(error)}`);
        },
      );
    });

    // The mouse's back and forward buttons.
    const mouse = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      event.preventDefault();
      if (event.button === 3) history.back();
      else history.forward();
    };
    addEventListener("mouseup", mouse);
    destroyRef.onDestroy(() => removeEventListener("mouseup", mouse));
    // Terminals belong to the repository; the backend ends their shells as it closes.
    destroyRef.onDestroy(() => this.terminals.closeAll());
  }
}
