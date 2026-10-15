/** The web demo's controls for the views: whether this is the demo, starting over, and getting the app. */
import { Injectable, inject } from "@angular/core";
import type { Location } from "../../../contracts/model";
import { DEMO } from "../platform/platform";
import { Dialogs } from "./dialogs";
import { ExternalLinks } from "./external-links";
import { Session } from "./session";

export type { OpenedClone, StoredClone } from "../platform/real-repositories/real-repositories";

@Injectable({ providedIn: "root" })
export class Demo {
  private readonly controls = inject(DEMO);
  private readonly dialogs = inject(Dialogs);
  private readonly links = inject(ExternalLinks);
  private readonly session = inject(Session);
  /** True in the web demo. */
  readonly active = this.controls !== null;
  /** The experiment with real repositories; only when the demo's address asks for it. */
  readonly realRepositories = this.controls?.realRepositories ?? null;

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

  /** The experiment: clones a repository into the browser, or picks one cloned before, and opens it. */
  async openFromUrl(): Promise<void> {
    const { RealRepositoryDialog } = await import("../features/demo/real-repository-dialog");
    const location = await this.dialogs.open<Location>(RealRepositoryDialog);
    if (location) await this.session.open(location);
  }

  /** Whether the open repository is a clone of the experiment, whose commits can be pushed with wasm-git. */
  isClone(): boolean {
    const location = this.session.snapshot()?.location;
    return !!location && !!this.realRepositories?.isClone(location);
  }

  /** The experiment: records the commits made here in the clone with wasm-git, pushes them, and opens the clone again. */
  async pushWithWasmGit(): Promise<void> {
    const location = this.session.snapshot()?.location;
    if (!location || !this.realRepositories) return;
    const result = await this.session.run(() => this.realRepositories!.push(location));
    if (!result) return;
    console.info(
      "[real-repositories] push",
      JSON.stringify({ pushed: result.pushed, pushMilliseconds: result.pushMilliseconds, ...result.measurement }),
    );
    await this.session.open(result.location);
  }

  download(): Promise<void> {
    return this.links.open(this.controls?.downloadUrl ?? "");
  }
}
