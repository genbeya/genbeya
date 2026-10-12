/**
 * Getting to know Genbeya: the welcome card and sample repository for new
 * users, the tour offered once in each repository until the user has seen
 * it, and what's new after an update. What the user has seen is kept in the
 * preferences. The tour's steps and the news load when they are shown.
 */
import { computed, effect, Injectable, inject, signal, untracked } from "@angular/core";
import { repositoryKey } from "../../../../contracts/model";
import { compareVersions, parseVersion } from "../../../../utilities/version";
import { APP_VERSION } from "../../core/app-version";
import { Dialogs } from "../../core/dialogs";
import { ExternalLinks } from "../../core/external-links";
import { CTRL_KEY, MOD_KEY } from "../../core/hotkeys";
import { Repositories } from "../../core/repositories";
import { Session } from "../../core/session";
import { Tour } from "../../ui/tour/tour";
import type { Release } from "./changelog";

export const DOCS_URL = "https://github.com/h3ll5ur7er/gitdesk/tree/main/docs";

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

  /** Shows `releases`, by default all news up to this version; "Show me" tours the items that point at something. */
  async showWhatsNew(shown?: readonly Release[]): Promise<void> {
    const { CHANGELOG, news, newsTour } = await import("./changelog");
    const releases = shown ?? news(CHANGELOG, APP_VERSION);
    if (!releases.length) return;
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
    const seen = parseVersion(lastSeenVersion);
    if (seen && compareVersions(seen, parseVersion(APP_VERSION)!) >= 0) return;
    if (seen) {
      const { CHANGELOG, news } = await import("./changelog");
      await this.showWhatsNew(news(CHANGELOG, APP_VERSION, lastSeenVersion!));
    }
    await this.session.setPreferences({ lastSeenVersion: APP_VERSION });
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
