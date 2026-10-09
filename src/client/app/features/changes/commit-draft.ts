import { Injectable, signal } from "@angular/core";

/**
 * The commit message being written. Provided by the shell, so it lives as
 * long as the repository is open and survives a look at another view.
 */
@Injectable()
export class CommitDraft {
  readonly message = signal("");
  readonly amend = signal(false);

  clear(): void {
    this.message.set("");
    this.amend.set(false);
  }
}
