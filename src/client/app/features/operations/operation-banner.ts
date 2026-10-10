import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";
import { RouterLink } from "@angular/router";
import type { Operation } from "../../../../contracts/model";
import { Session } from "../../core/session";
import { Icon } from "../../ui/icon";
import { OperationActions } from "./operation-actions";

/** What an operation in progress does, such as "Merging feature into main". */
export function describeOperation({ kind, source, target, step, steps }: Operation): string {
  switch (kind) {
    case "merge":
      return `Merging ${source}${target ? ` into ${target}` : ""}`;
    case "rebase":
      return `Rebasing ${source}${target ? ` onto ${target}` : ""}${step && steps ? ` (${step} of ${steps})` : ""}`;
    case "cherry-pick":
      return `Cherry-picking “${source}”`;
    case "revert":
      return `Reverting “${source}”`;
  }
}

/** The merge, rebase, cherry-pick or revert in progress, its conflicts, and how to go on. */
@Component({
  selector: "gd-operation-banner",
  imports: [Icon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 8px 8px 0 0;
      padding: 7px 8px 7px 12px;
      border: 1px solid var(--line);
      border-radius: var(--radius-l);
      background: var(--yellow-soft);
    }

    .operation-text {
      flex: 1;
      min-width: 0;
      font-weight: 500;
    }

    .operation-conflicts {
      color: var(--text-2);
      font-weight: 400;
    }
  `,
  host: { role: "status", "[attr.aria-label]": "description()" },
  template: `
    <svg gd-icon name="git-merge" [size]="15"></svg>
    <span class="operation-text ellipsis">
      {{ description() }}
      <span class="operation-conflicts"
        >— {{ conflicts() ? conflicts() + (conflicts() === 1 ? " conflict" : " conflicts") : "no conflicts left" }}</span
      >
    </span>
    @if (conflicts()) {
      <a class="btn btn-ghost btn-s" routerLink="/changes"><span>Resolve</span></a>
    }
    @if (operation().kind !== "merge") {
      <button type="button" class="btn btn-default btn-s" [disabled]="session.busy()" (click)="actions.skip()"><span>Skip</span></button>
    }
    <button type="button" class="btn btn-default btn-s" [disabled]="session.busy()" (click)="actions.abort()"><span>Abort</span></button>
    <button
      type="button"
      class="btn btn-primary btn-s"
      [disabled]="session.busy() || conflicts() > 0"
      [title]="conflicts() ? 'Resolve the conflicts first' : ''"
      (click)="actions.continue()"
    >
      <span>Continue</span>
    </button>
  `,
})
export class OperationBanner {
  protected readonly session = inject(Session);
  protected readonly actions = inject(OperationActions);
  protected readonly operation = computed(() => this.session.snapshot()!.operation!);
  protected readonly description = computed(() => describeOperation(this.operation()));
  protected readonly conflicts = computed(() => this.session.snapshot()!.changes.filter((change) => change.conflict).length);
}
