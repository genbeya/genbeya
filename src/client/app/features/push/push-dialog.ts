import { DIALOG_DATA, DialogRef } from "@angular/cdk/dialog";
import { afterNextRender, ChangeDetectionStrategy, Component, computed, type ElementRef, inject, signal, viewChild } from "@angular/core";
import { isDefaultBranch, type PushPlan } from "../../../../contracts/model";
import { DialogFrame } from "../../ui/dialog-frame";

export interface PushDialogRequest {
  readonly plan: PushPlan;
}

/** Where to push, and how. */
export interface PushChoice {
  readonly remote: string;
  readonly remoteBranch: string;
  readonly setUpstream: boolean;
  readonly force: boolean;
}

/**
 * Asks where to push a local branch: the remote, the branch there (any
 * name), whether it becomes the upstream and whether to force push.
 * Closes with the choice, or nothing when cancelled.
 */
@Component({
  selector: "gd-push-dialog",
  imports: [DialogFrame],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <gd-dialog-frame [title]="'Push ' + plan.branch" [width]="480" (submitted)="submit()">
      <label class="field">
        Remote
        <select #remoteField class="select" (change)="remote.set(remoteField.value)">
          @for (target of plan.remotes; track target.remote) {
            <option [value]="target.remote" [selected]="target.remote === remote()">{{ target.remote }}</option>
          }
        </select>
      </label>
      <label class="field">
        Remote branch
        <input
          #nameField
          class="input"
          spellcheck="false"
          list="push-dialog-branches"
          [value]="name()"
          (input)="name.set(nameField.value)"
        />
        <datalist id="push-dialog-branches">
          @for (branch of target().branches; track branch) {
            <option [value]="branch"></option>
          }
        </datalist>
      </label>
      @if (warning(); as message) {
        <p class="dialog-warning" role="note">{{ message }}</p>
      }
      <label class="checkbox">
        <input #upstreamField type="checkbox" [checked]="setUpstream()" (change)="setUpstream.set(upstreamField.checked)" />
        Set as upstream
      </label>
      <p class="dialog-hint">{{ upstreamHint() }}</p>
      <label class="checkbox">
        <input #forceField type="checkbox" [checked]="force()" (change)="force.set(forceField.checked)" />
        Force (with lease)
      </label>
      <p class="dialog-hint">
        Replaces the remote branch, as long as it is still where your last fetch saw it. You see what it loses first.
      </p>
      <footer>
        <button type="button" class="btn btn-default btn-m" (click)="dialog.close()"><span>Cancel</span></button>
        <button type="submit" class="btn btn-primary btn-m" [disabled]="!trimmed()">
          <span>{{ force() ? "Force push…" : "Push" }}</span>
        </button>
      </footer>
    </gd-dialog-frame>
  `,
})
export class PushDialog {
  protected readonly plan = inject<PushDialogRequest>(DIALOG_DATA).plan;
  protected readonly dialog = inject<DialogRef<PushChoice>>(DialogRef);
  private readonly upstream = this.plan.upstream;
  protected readonly remote = signal(
    this.upstream?.remote ?? this.plan.remotes.find((target) => target.remote === "origin")?.remote ?? this.plan.remotes[0]!.remote,
  );
  protected readonly name = signal(this.upstream?.remote === this.remote() ? this.upstream.branch : this.plan.branch);
  protected readonly setUpstream = signal(!this.upstream);
  protected readonly force = signal(false);
  protected readonly trimmed = computed(() => this.name().trim());
  protected readonly target = computed(() => this.plan.remotes.find((target) => target.remote === this.remote())!);
  private readonly nameField = viewChild.required<ElementRef<HTMLInputElement>>("nameField");

  /** Pushing somewhere other than the upstream, to the remote's default branch or a branch it already has, deserves a look. */
  protected readonly warning = computed(() => {
    const name = this.trimmed();
    const { remote, defaultBranch, branches } = this.target();
    if (!name || (this.upstream?.remote === remote && this.upstream.branch === name)) return null;
    if (isDefaultBranch(name, defaultBranch) && (defaultBranch !== null || branches.includes(name)))
      return `${name} is the default branch of ${remote}: your commits go onto the branch everyone starts from.`;
    if (branches.includes(name)) return `${remote} already has a branch ${name}, and it is not the upstream of ${this.plan.branch}.`;
    return null;
  });

  protected readonly upstreamHint = computed(() => {
    const upstream = this.upstream ? `${this.upstream.remote}/${this.upstream.branch}` : null;
    const chosen = `${this.remote()}/${this.trimmed() || "…"}`;
    if (!this.setUpstream()) return upstream ? `${this.plan.branch} keeps pulling from and pushing to ${upstream}.` : "No upstream is set.";
    return upstream && upstream !== chosen
      ? `${chosen} replaces ${upstream} as where ${this.plan.branch} pulls from and pushes to.`
      : `${this.plan.branch} pulls from and pushes to ${chosen} from now on.`;
  });

  constructor() {
    afterNextRender(() => this.nameField().nativeElement.select());
  }

  protected submit() {
    const remoteBranch = this.trimmed();
    if (!remoteBranch) return;
    this.dialog.close({ remote: this.remote(), remoteBranch, setUpstream: this.setUpstream(), force: this.force() });
  }
}
