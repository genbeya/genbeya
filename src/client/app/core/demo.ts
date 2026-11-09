/** The web demo's controls for the views: whether this is the demo, starting over, and getting the app. */
import { Injectable, inject } from "@angular/core";
import { DEMO, type DemoAbout, type DemoAction } from "../platform/platform";
import { Dialogs } from "./dialogs";
import { ExternalLinks } from "./external-links";
import { Notifications } from "./notifications";

export type { DemoAbout, DemoAction };

/** The demo's own words; a page that runs Genbeya on something else says what it is. */
export const DEMO_ABOUT: DemoAbout = {
  title: "About this demo",
  pill: "Demo",
  caption: "Runs in your browser",
  note: "Genbeya runs here in your browser, on a sample project with a simulated remote. Nothing you do is saved or sent anywhere, and reloading the page starts over.",
  reset: {
    label: "Reset demo",
    title: "Reset the demo?",
    message: "Everything you changed goes, and the sample project starts over as it was.",
  },
};

@Injectable({ providedIn: "root" })
export class Demo {
  private readonly controls = inject(DEMO);
  private readonly dialogs = inject(Dialogs);
  private readonly links = inject(ExternalLinks);
  private readonly notifications = inject(Notifications);
  /** True in the web demo. */
  readonly active = this.controls !== null;

  /** What the badge says now. */
  get about(): DemoAbout {
    return this.controls?.about?.() ?? DEMO_ABOUT;
  }

  /** The badge menu's other choices now. */
  actions(): readonly DemoAction[] {
    return this.controls?.actions?.() ?? [];
  }

  /** Starts over, once the visitor confirms. */
  async reset(): Promise<void> {
    const { title, message, label, danger = true } = this.about.reset;
    const confirmed = await this.dialogs.confirm({ title, message, confirm: label, danger });
    if (confirmed) this.controls?.reset();
  }

  /** Runs one of the badge's choices once the visitor confirms it, and says what came of it. */
  async run(action: DemoAction): Promise<void> {
    if (action.confirm) {
      const { title, message, label, danger = false } = action.confirm;
      if (!(await this.dialogs.confirm({ title, message, confirm: label, danger }))) return;
    }
    try {
      const outcome = await action.run();
      if (outcome) this.notifications.success(outcome);
    } catch (error) {
      this.notifications.error(error);
    }
  }

  /** Opens the page the badge links to. */
  openLink(): Promise<void> {
    return this.links.open(this.about.link?.url ?? "");
  }

  download(): Promise<void> {
    return this.links.open(this.controls?.downloadUrl ?? "");
  }
}
