import { computed, inject, Injectable } from "@angular/core";
import type { PullRequest } from "../../../../contracts/model";
import { taskIdsOf } from "../../../../utilities/pull-requests";
import { Session } from "../../core/session";

/** Which pull requests name which tasks, in their source branch, title or description; worked out once per snapshot. */
@Injectable({ providedIn: "root" })
export class PullLinks {
  private readonly session = inject(Session);
  private readonly byTask = computed(() => {
    const snapshot = this.session.snapshot();
    const links = new Map<string, PullRequest[]>();
    if (!snapshot) return links;
    for (const pull of snapshot.pulls)
      for (const id of taskIdsOf(pull, snapshot.settings.taskPrefix)) links.set(id, [...(links.get(id) ?? []), pull]);
    return links;
  });

  /** The pull requests naming task `id`. */
  of(id: string): readonly PullRequest[] {
    return this.byTask().get(id.toUpperCase()) ?? [];
  }

  /** Whether one of them is open or a draft. */
  hasOpen(id: string): boolean {
    return this.of(id).some((pull) => pull.status === "open" || pull.status === "draft");
  }
}
