/**
 * Repositories from GitHub kept in the browser, with the visitor's changes, when the visitor chooses to:
 * each as two kept files, a small summary to list it by and its whole state (`repository-state.ts`).
 * Opening a kept repository asks nothing of GitHub. Tokens are never kept.
 */
import type { KeptFiles } from "../../access/browser/kept-files";
import { loadRepository, saveRepository, type RepositoryState } from "../../access/memory/repository-state";
import type { GitHubAddress } from "../../utilities/github-address";
import { backendOn, type GitHubBackend, type GitHubSummary } from "./github-backend";

const VERSION = 1;
const HOST = "github.com";

/** A kept repository, as the notice lists it. */
export interface KeptRepository extends GitHubSummary {
  /** When it was last saved, ISO 8601. */
  readonly savedAt: string;
  /** How long its state is, in characters. */
  readonly size: number;
}

interface SummaryFile extends KeptRepository {
  readonly version: typeof VERSION;
  readonly host: typeof HOST;
}

/** The name kept files of a repository start with: only letters, digits, `.`, `-`, `_` and `%`. */
export function keptName({ owner, name, branch }: { owner: string; name: string; branch: string }): string {
  return [HOST, owner.toLowerCase(), name.toLowerCase(), branch]
    .map((part) => encodeURIComponent(part).replace(/[!'()*~]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("_");
}

/** Only the summary's own fields, whatever else `value` holds. */
function summaryOf(value: GitHubSummary): GitHubSummary {
  const { owner, name, webUrl, cloneUrl, defaultBranch, branch, commit, unread, skipped, truncated } = value;
  return { owner, name, private: value.private, webUrl, cloneUrl, defaultBranch, branch, commit, unread, skipped, truncated };
}

export class GitHubKeeper {
  /** What was last saved per repository, so saving unchanged state writes nothing. */
  private readonly saved = new Map<string, string>();

  constructor(
    private readonly files: KeptFiles,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Every kept repository, most recently saved first. */
  async list(): Promise<KeptRepository[]> {
    const kept: KeptRepository[] = [];
    for (const file of await this.files.list()) {
      if (!file.endsWith(".summary.json")) continue;
      try {
        const summary = JSON.parse((await this.files.read(file)) ?? "null") as SummaryFile | null;
        if (summary?.version === VERSION && summary.host === HOST)
          kept.push({ ...summaryOf(summary), savedAt: summary.savedAt, size: summary.size });
      } catch {
        // A damaged summary lists nothing; deleting everything still removes it.
      }
    }
    return kept.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
  }

  /** The kept copy of the repository `address` names: its branch, or else the default branch's copy. */
  async find(address: GitHubAddress): Promise<KeptRepository | null> {
    const same = (kept: KeptRepository) =>
      kept.owner.toLowerCase() === address.owner.toLowerCase() && kept.name.toLowerCase() === address.name.toLowerCase();
    const kept = (await this.list()).filter(same);
    return kept.find((repository) => (address.branch ?? repository.defaultBranch) === repository.branch) ?? null;
  }

  /** Opens a kept repository as it was saved. */
  async open(kept: KeptRepository, now: () => Date = this.now): Promise<GitHubBackend> {
    const name = keptName(kept);
    const text = await this.files.read(`${name}.state.json`);
    if (text === null) throw new Error("This kept repository is gone: it was deleted, or the browser cleared it.");
    const state = JSON.parse(text) as RepositoryState;
    const backend = backendOn(summaryOf(kept), (options) => loadRepository(state, options), now);
    this.saved.set(name, text);
    return backend;
  }

  /** Keeps `backend`'s repository as it is now; writes nothing when nothing changed since it was last saved. */
  async save({ summary, repository }: GitHubBackend): Promise<boolean> {
    const name = keptName(summary);
    const text = JSON.stringify(saveRepository(repository));
    if (this.saved.get(name) === text) return false;
    const file: SummaryFile = { version: VERSION, host: HOST, ...summaryOf(summary), savedAt: this.now().toISOString(), size: text.length };
    // The state first: a summary always names state that exists.
    await this.files.write(`${name}.state.json`, text);
    await this.files.write(`${name}.summary.json`, JSON.stringify(file));
    this.saved.set(name, text);
    return true;
  }

  async remove(kept: Pick<GitHubSummary, "owner" | "name" | "branch">): Promise<void> {
    const name = keptName(kept);
    await this.files.remove(`${name}.summary.json`);
    await this.files.remove(`${name}.state.json`);
    this.saved.delete(name);
  }

  /** Deletes every file Genbeya keeps in this browser, damaged ones included. */
  async removeAll(): Promise<void> {
    for (const file of await this.files.list()) await this.files.remove(file);
    this.saved.clear();
  }

  persist(): Promise<boolean> {
    return this.files.persist();
  }

  usage(): Promise<number> {
    return this.files.usage();
  }
}
