import { inject, Injectable, signal } from "@angular/core";
import { Session } from "../../core/session";

/**
 * The commit message being written. Provided by the shell, so it lives as
 * long as the repository is open and survives a look at another view.
 * While amending, snapshots compare staged changes with HEAD's parent, so
 * the last commit's changes show as staged.
 */
@Injectable()
export class CommitDraft {
  private readonly session = inject(Session);
  private readonly amending = signal(false);
  readonly message = signal("");
  readonly amend = this.amending.asReadonly();

  setAmend(amend: boolean): void {
    this.amending.set(amend);
    void this.session.compareWith(amend ? "parent" : "head");
  }

  clear(): void {
    this.message.set("");
    this.setAmend(false);
  }
}
