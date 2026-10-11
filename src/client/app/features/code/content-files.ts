/**
 * Files of a content area kept on the content branch, such as task
 * templates: the code view shows the checkout, so it cannot open them.
 */
import { Injectable, inject } from "@angular/core";
import { Clipboard } from "../../core/clipboard";
import { Dialogs } from "../../core/dialogs";
import { Session } from "../../core/session";

@Injectable({ providedIn: "root" })
export class ContentFiles {
  private readonly session = inject(Session);
  private readonly dialogs = inject(Dialogs);
  private readonly clipboard = inject(Clipboard);

  /** Says where `path` is and how to edit it, and offers to copy the path. `area` names what lives with it, such as "tasks". */
  async explain(path: string, title: string, area = "content"): Promise<void> {
    const branch = this.session.snapshot()?.storage.branch?.name ?? "gitdesk";
    const copy = await this.dialogs.confirm({
      title,
      message:
        `${path} is on the ${branch} branch, with the ${area}. The code view shows the checkout, so edit it in the ` +
        `branch's worktree inside .git (git worktree list names it), or move the ${area} to the checkout.`,
      confirm: "Copy path",
    });
    if (copy) await this.clipboard.copy(path, "Path");
  }
}
