/** Launches GitDesk on a disposable repository and profile for each test. */
import { _electron as electron, test as base, type ElectronApplication, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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

interface Fixtures {
  files: Readonly<Record<string, string>>;
  repository: Repository;
  app: ElectronApplication;
  window: Page;
}

export const test = base.extend<Fixtures>({
  files: [FILES, { option: true }],
  repository: async ({ files }, use) => {
    const repository = createRepository(files);
    await use(repository);
    rmSync(repository.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  },
  app: async ({ repository }, use) => {
    const profile = mkdtempSync(path.join(tmpdir(), "gitdesk-profile-"));
    const app = await electron.launch({
      args: [".", `--user-data-dir=${profile}`, launchArgument({ kind: "local", path: repository.root })],
      cwd: path.resolve("."),
    });
    await use(app);
    await app.close();
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  },
  window: async ({ app }, use) => {
    const window = await app.firstWindow();
    // The size of a CI runner's screen, so layouts match everywhere.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1000, 680));
    await window.waitForSelector("gd-shell");
    await use(window);
  },
});

export { expect } from "@playwright/test";

/** Ctrl on Windows and Linux, Cmd on macOS. */
export const MOD = process.platform === "darwin" ? "Meta" : "Control";
