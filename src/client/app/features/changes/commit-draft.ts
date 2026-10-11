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
  /** The message before amending began, and the last commit's message if amending filled it in. */
  private beforeAmend: { readonly draft: string; readonly loaded: string | null } | null = null;
  readonly message = signal("");
  readonly amend = this.amending.asReadonly();

  /**
   * Turning amend off brings back the message from before, unless the user
   * edited the last commit's message meanwhile: edits are kept.
   */
  setAmend(amend: boolean): void {
    if (amend && !this.amending()) this.beforeAmend = { draft: this.message(), loaded: null };
    if (!amend && this.amending() && this.beforeAmend) {
      const { draft, loaded } = this.beforeAmend;
      if (loaded !== null && this.message() === loaded) this.message.set(draft);
      this.beforeAmend = null;
    }
    this.amending.set(amend);
    void this.session.compareWith(amend ? "parent" : "head");
  }

  /** Fills in the message of the commit being amended, unless the user has written one. */
  loadAmended(message: string): void {
    if (!this.amending() || !this.beforeAmend || this.message().trim()) return;
    this.message.set(message);
    this.beforeAmend = { ...this.beforeAmend, loaded: message };
  }

  clear(): void {
    this.beforeAmend = null;
    this.message.set("");
    this.setAmend(false);
  }
}
