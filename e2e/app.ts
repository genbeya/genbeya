/** Launches GitDesk on a disposable repository and profile for each test. */
import { _electron as electron, test as base, type ElectronApplication, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Preferences } from "../src/contracts/model";
import { launchArgument } from "../src/utilities/launch-request";

export const FILES: Readonly<Record<string, string>> = {
  ".gitdesk.yml": "name: Demo Project\ntaskPrefix: DP\n",
  "docs/Home.md":
    "# Home\n\n[TOC]\n\n## Start\n\nSee [[Guide]] and DP-1. Missing: [[Glossary]].\n\n## Diagrams\n\n```plantuml\nAlice -> Bob: hello\n```\n",
  "docs/Guide.md": "# Guide\n\nHow it works.\n",
  "tasks/DP-1.md": "---\nid: DP-1\ntitle: First task\nstatus: todo\npriority: high\n---\n\n- [ ] Check me\n",
  "src/index.ts": "export const value = 1;\n",
};

export interface Repository {
  readonly root: string;
  read(relative: string): string | null;
  write(relative: string, content: string): void;
  git(...args: string[]): string;
}

function createRepository(files: Readonly<Record<string, string>>): Repository {
  const root = mkdtempSync(path.join(tmpdir(), "gitdesk-e2e-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  const write = (relative: string, content: string) => {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    writeFileSync(path.join(root, relative), content);
  };
  git("init", "-q", "-b", "main");
  git("config", "user.name", "E2E");
  git("config", "user.email", "e2e@example.com");
  git("config", "core.autocrlf", "false");
  for (const [relative, content] of Object.entries(files)) write(relative, content);
  git("add", ".");
  git("commit", "-q", "-m", "Initial commit");
  // Missing files read as null, so polls can wait for them to appear.
  const read = (relative: string) => (existsSync(path.join(root, relative)) ? readFileSync(path.join(root, relative), "utf8") : null);
  return { root, git, write, read };
}

export const VERSION: string = (JSON.parse(readFileSync("package.json", "utf8")) as { version: string }).version;

/** A user who has seen the tour and this version's news, so neither gets in the way of tests. */
export const SEEN: Partial<Preferences> = { lastSeenVersion: VERSION, tourSeen: true };

/** The preferences GitDesk saved in `profile`. */
export const savedPreferences = (profile: string): Partial<Preferences> =>
  (JSON.parse(readFileSync(path.join(profile, "state.json"), "utf8")) as { preferences: Partial<Preferences> }).preferences;

interface Fixtures {
  files: Readonly<Record<string, string>>;
  /** The preferences the profile starts with; null for a fresh profile, as on a first start. */
  preferences: Partial<Preferences> | null;
  /** The app's data folder for the test. */
  profile: string;
  repository: Repository;
  /** Starts GitDesk with these arguments on the test's profile; every launch closes after the test. */
  launch: (...args: string[]) => Promise<ElectronApplication>;
  app: ElectronApplication;
  window: Page;
}

/**
 * Closes the app. A test that fails mid-edit leaves unsaved changes, and the
 * "discard them?" dialog would block closing until the fixture times out; the
 * process is ended instead.
 */
async function closeApp(app: ElectronApplication): Promise<void> {
  // A test may leave unsaved edits. Closing would then ask whether to discard them, in a dialog that
  // blocks the main process; destroying the windows skips that question.
  await app
    .evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.destroy();
    })
    .catch(() => undefined);
  const closed = app.close().then(
    () => true,
    () => true,
  );
  const timedOut = new Promise<false>((resolve) => setTimeout(() => resolve(false), 10_000));
  // Playwright's close never settles once the window refuses to close, so it is not awaited after the kill.
  if (!(await Promise.race([closed, timedOut]))) kill(app.process().pid);
}

/** Ends the app with all its processes; on Windows, killing the main process leaves its windows open. */
function kill(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(pid, "SIGKILL");
  } catch {
    // Already gone.
  }
}

/** The app's window at the size of a CI runner's screen, so layouts match everywhere. */
export async function sizedWindow(app: ElectronApplication): Promise<Page> {
  const window = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1000, 680));
  return window;
}

/** The app's window once it shows a repository. */
export async function mainWindow(app: ElectronApplication): Promise<Page> {
  const window = await sizedWindow(app);
  await window.waitForSelector("gd-shell");
  return window;
}

export const test = base.extend<Fixtures>({
  files: [FILES, { option: true }],
  preferences: [SEEN, { option: true }],
  profile: async ({ preferences }, use) => {
    const profile = mkdtempSync(path.join(tmpdir(), "gitdesk-profile-"));
    if (preferences) writeFileSync(path.join(profile, "state.json"), JSON.stringify({ preferences }));
    await use(profile);
    // After a launch that had to be ended, its helper processes may hold the profile for a few seconds.
    rmSync(profile, { recursive: true, force: true, maxRetries: 50, retryDelay: 200 });
  },
  repository: async ({ files }, use) => {
    const repository = createRepository(files);
    await use(repository);
    rmSync(repository.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  },
  // Needing the repository makes Playwright remove it only after every launch has closed and let go of it.
  launch: async ({ profile, repository: _repository }, use) => {
    const running = new Set<ElectronApplication>();
    await use(async (...args) => {
      const app = await electron.launch({ args: [".", `--user-data-dir=${profile}`, ...args], cwd: path.resolve(".") });
      running.add(app);
      app.once("close", () => running.delete(app));
      return app;
    });
    for (const app of running) await closeApp(app);
  },
  app: async ({ launch, repository }, use) => {
    await use(await launch(launchArgument({ kind: "local", path: repository.root })));
  },
  window: async ({ app }, use) => {
    await use(await mainWindow(app));
  },
});

export { expect } from "@playwright/test";

/** Ctrl on Windows and Linux, Cmd on macOS. */
export const MOD = process.platform === "darwin" ? "Meta" : "Control";
