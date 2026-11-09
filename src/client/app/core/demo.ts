/** The web demo's controls for the views: whether this is the demo, starting over, and getting the app. */
import { Injectable, inject } from "@angular/core";
import { DEMO, type DemoAbout } from "../platform/platform";
import { Dialogs } from "./dialogs";
import { ExternalLinks } from "./external-links";

export type { DemoAbout };

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
  /** True in the web demo. */
  readonly active = this.controls !== null;
  /** What the badge says. */
  readonly about: DemoAbout = this.controls?.about ?? DEMO_ABOUT;

  /** Starts over, once the visitor confirms. */
  async reset(): Promise<void> {
    const { title, message, label } = this.about.reset;
    const confirmed = await this.dialogs.confirm({ title, message, confirm: label, danger: true });
    if (confirmed) this.controls?.reset();
  }

  /** Opens the page the badge links to. */
  openLink(): Promise<void> {
    return this.links.open(this.about.link?.url ?? "");
  }

  download(): Promise<void> {
    return this.links.open(this.controls?.downloadUrl ?? "");
  }
}
