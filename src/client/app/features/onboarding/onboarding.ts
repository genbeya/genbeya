/**
 * Getting to know Genbeya: the welcome card and sample repository for new
 * users, the tour offered once in each repository until the user has seen
 * it, and what's new after an update. What the user has seen is kept in the
 * preferences. The tour's steps and the news load when they are shown.
 */
import { computed, effect, Injectable, InjectionToken, inject, signal, untracked } from "@angular/core";
import { repositoryKey } from "../../../../contracts/model";
import { compareVersions, parseVersion } from "../../../../utilities/version";
import { APP_VERSION } from "../../core/app-version";
import { Dialogs } from "../../core/dialogs";
import { ExternalLinks } from "../../core/external-links";
import { CTRL_KEY, MOD_KEY } from "../../core/hotkeys";
import { Notifications } from "../../core/notifications";
import { Repositories } from "../../core/repositories";
import { Session } from "../../core/session";
import { Tour } from "../../ui/tour/tour";
import type { Release } from "./changelog";

export const DOCS_URL = "https://github.com/genbeya/genbeya/tree/main/docs";

/** The running version and its changelog, which loads on demand so it is not part of the initial bundle; tests provide their own. */
export interface ReleaseNotes {
  readonly version: string;
  readonly changelog: () => Promise<readonly Release[]>;
}

export const RELEASE_NOTES = new InjectionToken<ReleaseNotes>("release notes", {
  providedIn: "root",
  factory: () => ({ version: APP_VERSION, changelog: async () => (await import("./changelog")).CHANGELOG }),
});

/** What the What's new dialog shows; `tour` offers a tour of the items that point at something. */
export interface WhatsNew {
  readonly releases: readonly Release[];
  readonly tour: boolean;
}

@Injectable({ providedIn: "root" })
export class Onboarding {
  private readonly session = inject(Session);
  private readonly dialogs = inject(Dialogs);
  private readonly tour = inject(Tour);
  private readonly links = inject(ExternalLinks);
  private readonly repositories = inject(Repositories);
  private readonly notifications = inject(Notifications);
  private readonly notes = inject(RELEASE_NOTES);
  private readonly offered = signal(false);

  /** The welcome screen introduces Genbeya until the user opened a repository or took the tour. */
  readonly introduce = computed(() => !this.session.preferences().tourSeen && !this.repositories.recent().length);
  /** Whether the open repository offers the tour. */
  readonly offer = this.offered.asReadonly();

  constructor() {
    let greeted = false;
    effect(() => {
      if (this.session.phase() === "starting" || greeted) return;
      greeted = true;
      untracked(() => void this.greet());
    });
    effect(() => {
      if (this.session.id()) untracked(() => this.offerTour());
      else this.offered.set(false);
    });
  }

  async startTour(): Promise<void> {
    this.offered.set(false);
    const { appTour } = await import("./tour-steps");
    await this.tour.start(appTour({ mod: MOD_KEY, ctrl: CTRL_KEY }));
    await this.session.setPreferences({ tourSeen: true });
  }

  dismissOffer(): void {
    this.offered.set(false);
  }

  /**
   * Shows `releases`, by default all news up to this version; "Show me"
   * tours the items that point at something. Asked for all news while there
   * is none, it says so instead.
   */
  async showWhatsNew(shown?: readonly Release[]): Promise<void> {
    const { news, newsTour } = await import("./changelog");
    const releases = shown ?? news(await this.notes.changelog(), this.notes.version);
    if (!releases.length) {
      if (!shown) this.notifications.success(`Nothing new in Genbeya ${this.notes.version} yet.`);
      return;
    }
    const tour = newsTour(releases);
    const { WhatsNewDialog } = await import("./whats-new-dialog");
    const choice = await this.dialogs.open<"tour", WhatsNew>(WhatsNewDialog, {
      releases,
      tour: !!this.session.snapshot() && !!tour.length,
    });
    if (choice === "tour") await this.tour.start(tour);
  }

  /** Lets the user choose a folder, creates the sample repository in it and opens it. */
  async createSample(): Promise<void> {
    const parent = await this.repositories.pickFolder();
    if (parent) await this.session.createSample(parent);
  }

  openDocs(): Promise<void> {
    return this.links.open(DOCS_URL);
  }

  /**
   * Shows what's new once after an update. First-time users get the
   * onboarding instead, and nothing for a version they already know.
   */
  private async greet() {
    const { lastSeenVersion } = this.session.preferences();
    const { version } = this.notes;
    const seen = parseVersion(lastSeenVersion);
    if (seen && compareVersions(seen, parseVersion(version)!) >= 0) return;
    if (seen) {
      const { news } = await import("./changelog");
      await this.showWhatsNew(news(await this.notes.changelog(), version, lastSeenVersion!));
    }
    await this.session.setPreferences({ lastSeenVersion: version });
  }

  /** Offers the tour in a repository that has not offered it yet, unless the user has seen it. */
  private offerTour() {
    const snapshot = this.session.snapshot();
    const { tourSeen, tourOffered } = this.session.preferences();
    const key = snapshot && repositoryKey(snapshot.location);
    const offer = !!key && !tourSeen && !tourOffered.includes(key) && !this.tour.current();
    this.offered.set(offer);
    if (offer) void this.session.setPreferences({ tourOffered: [...tourOffered, key] });
  }
}
