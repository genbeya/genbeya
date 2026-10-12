/** The web demo's controls for the views: whether this is the demo, starting over, and getting the app. */
import { Injectable, inject } from "@angular/core";
import { DEMO } from "../platform/platform";
import { Dialogs } from "./dialogs";
import { ExternalLinks } from "./external-links";

@Injectable({ providedIn: "root" })
export class Demo {
  private readonly controls = inject(DEMO);
  private readonly dialogs = inject(Dialogs);
  private readonly links = inject(ExternalLinks);
  /** True in the web demo. */
  readonly active = this.controls !== null;

  /** Starts over with the sample project, once the visitor confirms. */
  async reset(): Promise<void> {
    const confirmed = await this.dialogs.confirm({
      title: "Reset the demo?",
      message: "Everything you changed goes, and the sample project starts over as it was.",
      confirm: "Reset demo",
      danger: true,
    });
    if (confirmed) this.controls?.reset();
  }

  download(): Promise<void> {
    return this.links.open(this.controls?.downloadUrl ?? "");
  }
}
