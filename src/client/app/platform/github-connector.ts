/**
 * Genbeya on GitHub, at `/github/<owner>/<repo>` on genbeya.fyi: the start screen (`github-notice.ts`) says
 * what the page requests and keeps; once the visitor chooses, the repository is read from GitHub, or its
 * kept copy opened, and the client runs on it with the web demo's managers (`github-backend.ts`).
 *
 * Keeping is the visitor's choice, off by default: then the repository is saved with every change to the
 * browser's private storage (`github-keeping.ts`), and one tab at a time holds it. A token is used while
 * the files are read, and then dropped; it is never kept.
 */
import { opfsFiles } from "../../../access/browser/kept-files";
import type { Fetch } from "../../../access/github/github-reader";
import type { Request } from "../../../contracts/rpc";
import { openGitHubBackend, type GitHubBackend, type GitHubSummary } from "../../../managers/demo/github-backend";
import { GitHubKeeper, type KeptRepository } from "../../../managers/demo/github-keeping";
import { gitHubAddressPath, parseGitHubAddress, type GitHubAddress } from "../../../utilities/github-address";
import { connectDemo, type DemoPage } from "./demo-connector";
import { StartScreen, type KeptCopy, type KeptTotal, type NoticePage } from "./github-notice";
import type { DemoAbout, DemoAction, Platform } from "./platform";

export { PRIVACY_URL } from "./github-notice";

export type GitHubPage = DemoPage & NoticePage;

export interface GitHubConnectorOptions {
  readonly fetch?: Fetch;
  /** Where kept repositories live; null when the browser can't keep them. */
  readonly keeper?: GitHubKeeper | null;
  /** One tab at a time keeps a repository; null where the browser has no locks. */
  readonly locks?: LockManager | null;
}

export const LOCKED =
  "This repository is open in another tab that keeps it. Close that tab first, or open the repository here without keeping it.";

/** Calls that change nothing, after which there is nothing to save. */
const READS = new Set([
  "workspace.open",
  "workspace.restore",
  "workspace.close",
  "workspace.snapshot",
  "workspace.recent",
  "workspace.preferences",
  "workspace.distributions",
  "workspace.browse",
  "content.read",
  "content.image",
  "content.pageLinks",
  "content.taskTemplate",
  "content.taskActivity",
  "content.commentAuthor",
  "content.agentFiles",
  "content.search",
  "content.people",
  "versionControl.diff",
  "versionControl.diffImages",
  "versionControl.lastCommitMessage",
  "versionControl.log",
  "versionControl.commitDetail",
  "versionControl.pushPlan",
  "versionControl.forcePushPlan",
  "versionControl.stashDetail",
  "versionControl.rebasePlan",
  "versionControl.resetPlan",
  "versionControl.conflict",
]);

const browserFetch: Fetch = (url, init) => globalThis.fetch(url, init);

function defaultKeeper(): GitHubKeeper | null {
  const files = opfsFiles();
  return files && new GitHubKeeper(files);
}

export async function connectGitHub(
  page: GitHubPage = window,
  { fetch = browserFetch, keeper = defaultKeeper(), locks = globalThis.navigator?.locks ?? null }: GitHubConnectorOptions = {},
): Promise<Platform> {
  const screen = new StartScreen(page);
  const address = parseGitHubAddress(page.location.pathname, page.location.search);
  const kept = (await keeper?.list().catch(() => [])) ?? [];
  const total = async (): Promise<KeptTotal | null> =>
    keeper ? { count: (await keeper.list()).length, bytes: await keeper.usage() } : null;
  const deleteAll = async () => keeper?.removeAll();
  if (!address) return screen.choose({ kept: kept.map(copyOf), total: await total(), deleteAll });

  const keptCopy = keeper && (await keeper.find(address));
  const keeping = new Keeping(keeper, locks);
  const backend = await screen.notice<GitHubBackend>(address, {
    canKeep: !!keeper,
    kept: keptCopy && copyOf(keptCopy),
    total: await total(),
    async read(token, keep, progress) {
      // Taking the lock first, so another tab can't keep the same repository meanwhile.
      if (keep) await keeping.lock(address);
      const opened = await openGitHubBackend(address, { fetch, token, progress });
      if (keep) await keeping.start(opened);
      return opened;
    },
    async openKept() {
      await keeping.lock(address);
      const opened = await keeper!.open(keptCopy!);
      await keeping.start(opened);
      return opened;
    },
    deleteKept: async () => keeper!.remove(keptCopy!),
    deleteAll,
  });
  screen.remove();
  return connectDemo(page, {
    backend: backend.managers,
    about: () => aboutGitHub(backend.summary, keeping),
    actions: () => keepingActions(address, backend, keeping),
    afterCall: (request) => keeping.changed(request),
  });
}

/** Keeping the open repository in the browser while the visitor wants it kept. */
export class Keeping {
  private backend: GitHubBackend | null = null;
  private release: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> = Promise.resolve();
  /** Why the last save failed, until one succeeds. */
  problem: string | null = null;

  constructor(
    readonly keeper: GitHubKeeper | null,
    private readonly locks: LockManager | null,
  ) {}

  get active(): boolean {
    return this.backend !== null;
  }

  /** Holds the repository for this tab until keeping stops or the tab closes; fails when another tab holds it. */
  async lock(address: Pick<GitHubAddress, "owner" | "name">): Promise<void> {
    if (this.release || !this.locks) return;
    const name = `genbeya:github.com/${address.owner}/${address.name}`.toLowerCase();
    const held = await new Promise<boolean>((resolve) => {
      void this.locks!.request(name, { ifAvailable: true }, (lock) => {
        if (!lock) return resolve(false);
        resolve(true);
        return new Promise<void>((done) => (this.release = done));
      });
    });
    if (!held) throw new Error(LOCKED);
  }

  /** Keeps `backend`'s repository from now on, saving it at once. */
  async start(backend: GitHubBackend): Promise<void> {
    if (!this.keeper) throw new Error("This browser can't keep files for web pages.");
    await this.lock(backend.summary);
    await this.keeper.persist().catch(() => false);
    this.backend = backend;
    await this.flush();
    if (this.problem) {
      this.backend = null;
      throw new Error(this.problem);
    }
    globalThis.addEventListener?.("pagehide", this.onHide);
  }

  /** Stops keeping and deletes the kept copy; the repository stays open in the tab. */
  async stop(): Promise<void> {
    const backend = this.backend;
    if (!backend || !this.keeper) return;
    this.backend = null;
    if (this.timer) clearTimeout(this.timer);
    await this.saving;
    await this.keeper.remove(backend.summary);
    globalThis.removeEventListener?.("pagehide", this.onHide);
    this.release?.();
    this.release = null;
  }

  /** After a call: saves soon, unless the call changed nothing. */
  changed(request: Request): void {
    if (!this.active || READS.has(`${request.manager}.${request.method}`)) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 300);
  }

  /** Saves now, after any save under way. */
  flush(): Promise<void> {
    this.timer = null;
    this.saving = this.saving.then(async () => {
      if (!this.backend || !this.keeper) return;
      try {
        await this.keeper.save(this.backend);
        this.problem = null;
      } catch (error) {
        this.problem = `Genbeya couldn't save your changes in this browser: ${error instanceof Error ? error.message : String(error)}`;
        console.error(error);
      }
    });
    return this.saving;
  }

  private readonly onHide = () => void this.flush();
}

/** The badge's choices about keeping: keep the repository, or stop and delete the kept copy. */
export function keepingActions(address: GitHubAddress, backend: GitHubBackend, keeping: Keeping): DemoAction[] {
  if (!keeping.keeper) return [];
  if (keeping.active)
    return [
      {
        label: "Delete the kept copy",
        icon: "trash-2",
        confirm: {
          title: "Delete the kept copy?",
          message:
            "Genbeya stops keeping this repository and deletes it from this browser, your changes included. It stays open in this tab until you close it.",
          label: "Delete",
          danger: true,
        },
        run: async () => {
          await keeping.stop();
          return "Deleted from this browser.";
        },
      },
    ];
  return [
    {
      label: "Keep in this browser",
      icon: "archive-restore",
      confirm: {
        title: "Keep this repository in this browser?",
        message:
          "Genbeya saves it with your changes in this browser's private storage for genbeya.fyi, so it opens again without asking GitHub, until you delete it. It never leaves your device, and tokens are never kept.",
        label: "Keep it",
      },
      run: async () => {
        await keeping.lock(address);
        await keeping.start(backend);
        return "Kept in this browser.";
      },
    },
  ];
}

/** What the badge says about the repository. */
export function aboutGitHub(summary: GitHubSummary, keeping?: Pick<Keeping, "active" | "problem">): DemoAbout {
  const label = `${summary.owner}/${summary.name}`;
  const { unread, skipped } = summary;
  const missing = [
    unread
      ? `Code has the files the wiki and the tasks refer to; ${unread === 1 ? "one other stays" : `${unread} others stay`} on GitHub.`
      : "",
    skipped ? `${skipped === 1 ? "One entry is" : `${skipped} entries are`} left out: links, submodules or files over a megabyte.` : "",
    summary.truncated ? "GitHub listed only part of the repository's files." : "",
  ].filter(Boolean);
  const branch = summary.branch === summary.defaultBranch ? "" : `/tree/${summary.branch.split("/").map(encodeURIComponent).join("/")}`;
  const kept = !!keeping?.active;
  return {
    title: "About this page",
    pill: "GitHub",
    caption: label,
    note: [
      `Genbeya runs here in your browser, on ${label} as it was on GitHub: ${summary.branch} at ${summary.commit.slice(0, 7)}.`,
      kept
        ? "It is kept in this browser, and your changes are saved as you go. Nothing is written back to GitHub."
        : "What you change stays in this tab. Nothing is written back to GitHub, and closing the tab forgets it.",
      ...(keeping?.problem ? [keeping.problem] : []),
      ...missing,
    ].join(" "),
    reset: kept
      ? {
          label: "Back to the start",
          title: "Go back to the start?",
          message:
            "Your changes stay kept in this browser: open the kept copy from the start page, or read the repository from GitHub again.",
          danger: false,
        }
      : {
          label: "Read again from GitHub",
          title: `Read ${label} again?`,
          message: "Everything you changed goes, and the repository is read from GitHub as it is now.",
        },
    link: { label: "Open on GitHub", url: summary.webUrl + branch },
  };
}

function copyOf(kept: KeptRepository): KeptCopy {
  const saved = new Date(kept.savedAt).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" });
  return {
    path: gitHubAddressPath(kept.branch === kept.defaultBranch ? { owner: kept.owner, name: kept.name } : kept),
    label: `${kept.owner}/${kept.name}`,
    description: `Branch ${kept.branch} at ${kept.commit.slice(0, 7)}, saved ${saved}`,
  };
}
