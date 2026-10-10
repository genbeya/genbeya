/**
 * Links to items of the open repository: GitDesk links, which open the item
 * in a coworker's clone, and the item's page on the Git host's website.
 * Both name the repository by a remote: origin, else the first one.
 */
import { computed, Injectable, inject } from "@angular/core";
import type { LinkItem } from "../../../contracts/gitdesk-link";
import { formatGitdeskLink } from "../../../utilities/gitdesk-link";
import { parseRemote, webUrl } from "../../../utilities/remote-url";
import { Clipboard } from "./clipboard";
import { Session } from "./session";

@Injectable({ providedIn: "root" })
export class ShareLinks {
  private readonly session = inject(Session);
  private readonly clipboard = inject(Clipboard);
  private readonly remote = computed(() => {
    const remotes = this.session.snapshot()?.remotes ?? [];
    return remotes.find((remote) => remote.name === "origin") ?? remotes[0] ?? null;
  });
  /** The branch the checkout's files are published on: its upstream's name, else the branch itself, else the commit. */
  private readonly codeBranch = computed(() => {
    const snapshot = this.session.snapshot();
    if (!snapshot) return null;
    const { upstream, branch, commit } = snapshot.head;
    if (!upstream) return branch ?? commit;
    const remote = snapshot.remotes.find((candidate) => upstream.startsWith(`${candidate.name}/`));
    return upstream.slice(remote ? remote.name.length + 1 : 0);
  });

  /** Why GitDesk links can't be made here, or null when they can. */
  readonly unavailable = computed(() => {
    const remote = this.remote();
    if (!remote) return "This repository has no remote. Others find their clone by its remote, so add one to share links.";
    return parseRemote(remote.url) ? null : `The remote ${remote.name} is a local path, which other computers can't reach.`;
  });

  gitdeskLink(item: LinkItem): string | null {
    const remote = this.remote();
    return remote && !this.unavailable() ? formatGitdeskLink({ remote: remote.url, item }) : null;
  }

  /** The item on the host's website; pages and tasks are files there. Null for hosts GitDesk does not know. */
  webLink(item: LinkItem): string | null {
    const snapshot = this.session.snapshot();
    const remote = this.remote();
    if (!snapshot || !remote) return null;
    if (item.kind === "commit") return webUrl(remote.url, item);
    const path = item.kind === "task" ? snapshot.tasks.find((task) => task.id === item.id)?.path : item.path;
    // Pages and tasks whose area lives on the content branch are there, not on the checked-out branch.
    const { areas, branch: content } = snapshot.storage;
    const onBranch = content && ((item.kind === "page" && areas.wiki === "branch") || (item.kind === "task" && areas.tasks === "branch"));
    const branch = onBranch ? content.name : this.codeBranch();
    return path && branch ? webUrl(remote.url, { kind: "file", path, branch }) : null;
  }

  async copyGitdeskLink(item: LinkItem): Promise<void> {
    const link = this.gitdeskLink(item);
    if (link) await this.clipboard.copy(link, "GitDesk link");
  }

  async copyWebLink(item: LinkItem): Promise<void> {
    const link = this.webLink(item);
    if (link) await this.clipboard.copy(link, "Web link");
  }
}
