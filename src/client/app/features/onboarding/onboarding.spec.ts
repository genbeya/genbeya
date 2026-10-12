import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import type { Preferences } from "../../../../contracts/model";
import { Dialogs } from "../../core/dialogs";
import { Notifications } from "../../core/notifications";
import { Session } from "../../core/session";
import { settle } from "../../testing/component-harness";
import { fakeManagers, fakeShell, PREFERENCES, providePlatform, snapshot } from "../../testing/fake-platform";
import { Tour } from "../../ui/tour/tour";
import { news, newsTour, type Release } from "./changelog";
import { Onboarding, RELEASE_NOTES } from "./onboarding";
import { WhatsNewDialog } from "./whats-new-dialog";

const NEW_USER: Preferences = { ...PREFERENCES, lastSeenVersion: null, tourSeen: false };
const location = { kind: "local", path: "/repo" } as const;
/** The running version and its news, newest first; the item of 1.1 points at something. */
const VERSION = "1.2.3";
const CHANGELOG: readonly Release[] = [
  { version: "1.2", items: [{ title: "Boards", body: "News." }] },
  { version: "1.1", items: [{ title: "Search", body: "News.", target: '[data-tour="search"]', route: "/search" }] },
];

async function setup(preferences: Partial<Preferences> = {}, dialogResult?: "tour", changelog = CHANGELOG) {
  const managers = fakeManagers();
  const shell = fakeShell();
  let saved: Preferences = { ...PREFERENCES, lastSeenVersion: VERSION, ...preferences };
  managers.workspace.preferences.mockResolvedValue(saved);
  managers.workspace.setPreferences.mockImplementation(async (change: Partial<Preferences>) => (saved = { ...saved, ...change }));
  const dialogs = { open: vi.fn(async () => dialogResult) };
  const tour = { start: vi.fn(async () => "completed"), current: signal(null) };
  TestBed.configureTestingModule({
    providers: [
      ...providePlatform(managers, shell),
      { provide: Dialogs, useValue: dialogs },
      { provide: Tour, useValue: tour },
      { provide: RELEASE_NOTES, useValue: { version: VERSION, changelog: async () => changelog } },
    ],
  });
  const onboarding = TestBed.inject(Onboarding);
  const session = TestBed.inject(Session);
  await session.start();
  await settle();
  TestBed.tick();
  await settle();
  return { managers, shell, dialogs, tour, onboarding, session, preferences: () => saved };
}

describe("Onboarding", () => {
  it("shows what's new once after an update, then remembers the version", async () => {
    const { dialogs, preferences } = await setup({ lastSeenVersion: "1.1.40" });
    // The news load on demand, so the dialog opens after an import that may take a while.
    await vi.waitFor(() => expect(dialogs.open).toHaveBeenCalledWith(WhatsNewDialog, { releases: [CHANGELOG[0]], tour: false }));
    await vi.waitFor(() => expect(preferences().lastSeenVersion).toBe(VERSION));
  });

  it("shows nothing after an update without news, and remembers the version", async () => {
    const { dialogs, preferences } = await setup({ lastSeenVersion: "1.2.0" }, undefined, []);
    await vi.waitFor(() => expect(preferences().lastSeenVersion).toBe(VERSION));
    expect(dialogs.open).not.toHaveBeenCalled();
  });

  it("tours the news that point at something, when asked to", async () => {
    const { onboarding, session, tour, managers } = await setup({}, "tour");
    managers.workspace.open.mockResolvedValue({ id: "w1", snapshot: snapshot() });
    await session.open(location);
    await onboarding.showWhatsNew();
    expect(tour.start).toHaveBeenCalledWith(newsTour(news(CHANGELOG, VERSION)));
    expect(tour.start).toHaveBeenCalledWith([expect.objectContaining({ target: '[data-tour="search"]', route: "/search" })]);
  });

  it("says so when asked for news while there is none", async () => {
    const { onboarding, dialogs } = await setup({}, undefined, []);
    const success = vi.spyOn(TestBed.inject(Notifications), "success");
    await onboarding.showWhatsNew();
    expect(dialogs.open).not.toHaveBeenCalled();
    expect(success).toHaveBeenCalledWith(`Nothing new in Genbeya ${VERSION} yet.`);
  });

  it("shows no news to first-time users, who get the welcome card", async () => {
    const { dialogs, onboarding, preferences } = await setup(NEW_USER);
    await vi.waitFor(() => expect(preferences().lastSeenVersion).toBe(VERSION));
    expect(dialogs.open).not.toHaveBeenCalled();
    expect(onboarding.introduce()).toBe(true);
  });

  it("shows nothing for a version the user knows", async () => {
    const { dialogs, managers, onboarding } = await setup();
    expect(dialogs.open).not.toHaveBeenCalled();
    expect(managers.workspace.setPreferences).not.toHaveBeenCalled();
    expect(onboarding.introduce()).toBe(false);
  });

  it("offers the tour once in each repository, until the user has seen it", async () => {
    const { onboarding, session, managers, tour, preferences } = await setup({ tourSeen: false });
    managers.workspace.open.mockResolvedValue({ id: "w1", snapshot: snapshot() });
    await session.open(location);
    TestBed.tick();
    expect(onboarding.offer()).toBe(true);
    expect(preferences().tourOffered).toEqual(["local:/repo"]);

    await onboarding.startTour();
    expect(tour.start).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ target: '[data-tour="views"]' })]));
    expect(onboarding.offer()).toBe(false);
    expect(preferences().tourSeen).toBe(true);
  });

  it("does not offer the tour again in a repository that offered it", async () => {
    const { onboarding, session, managers } = await setup({ tourSeen: false, tourOffered: ["local:/repo"] });
    managers.workspace.open.mockResolvedValue({ id: "w1", snapshot: snapshot() });
    await session.open(location);
    TestBed.tick();
    expect(onboarding.offer()).toBe(false);
  });

  it("creates the sample repository in the folder the user picks", async () => {
    const { onboarding, shell, managers } = await setup(NEW_USER);
    managers.workspace.createSample.mockResolvedValue({ id: "w1", snapshot: snapshot() });
    shell.pickFolder.mockResolvedValueOnce(null).mockResolvedValueOnce({ kind: "local", path: "/projects" });
    await onboarding.createSample();
    expect(managers.workspace.createSample).not.toHaveBeenCalled();
    await onboarding.createSample();
    expect(managers.workspace.createSample).toHaveBeenCalledWith({ kind: "local", path: "/projects" });
  });
});
