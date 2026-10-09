import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { Session } from "./core/session";
import { Theme } from "./core/theme";
import { Shell } from "./features/shell/shell";
import { Welcome } from "./features/welcome/welcome";
import { Toasts } from "./ui/toasts";

/** Starts the session, then shows the welcome screen or the open repository. */
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
    void this.session.start();
  }
}
