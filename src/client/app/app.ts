import { ChangeDetectionStrategy, Component, effect, inject, untracked } from "@angular/core";
import { ContextMenuGuard } from "./core/context-menu-guard";
import { NavigationGuard } from "./core/navigation-guard";
import { Session } from "./core/session";
import { Theme } from "./core/theme";
import { Onboarding } from "./features/onboarding/onboarding";
import { Shell } from "./features/shell/shell";
import { ShellUi } from "./features/shell/shell-ui";
import { Welcome } from "./features/welcome/welcome";
import { Toasts } from "./ui/toasts";

/**
 * Starts the session, then shows the welcome screen or the open repository, opens the Genbeya links launches carry,
 * and introduces Genbeya to new users and what's new to updated ones.
 */
@Component({
  selector: "gd-root",
  imports: [Shell, Welcome, Toasts],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (true) {
      @case (session.phase() === "starting") {
        <div class="boot"><span class="spinner" aria-label="Loading"></span></div>
      }
      @case (!session.snapshot()) {
        <gd-welcome />
      }
      @default {
        @for (id of [session.id()]; track id) {
          <gd-shell />
        }
      }
    }
    <gd-toasts />
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
    }
    .boot {
      display: grid;
      place-items: center;
      height: 100%;
    }
  `,
})
export class App {
  protected readonly session = inject(Session);

  constructor() {
    inject(Theme);
    inject(NavigationGuard);
    inject(ContextMenuGuard);
    inject(Onboarding);
    void this.session.start();
    // The first launch's link, or one a later launch hands over.
    const ui = inject(ShellUi);
    effect(() => {
      if (this.session.requestedLink()) untracked(() => void ui.openLink(this.session.takeRequestedLink()!));
    });
  }
}
