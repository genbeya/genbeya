import { ChangeDetectionStrategy, Component, computed, inject, input } from "@angular/core";
import { Session } from "../../core/session";

export interface Ref {
  /** As `git log --format=%D` lists it, such as "HEAD -> main" or "tag: v1". */
  readonly raw: string;
  readonly name: string;
  readonly kind: "branch" | "remote" | "tag";
  /** The checked-out branch. */
  readonly head: boolean;
}

/** The refs of a commit's `%D` decorations; names that are not local `branches` are remote unless they are tags or HEAD. */
export function parseRefs(decorations: readonly string[], branches: readonly string[]): Ref[] {
  return decorations.map((raw) => {
    const head = raw.startsWith("HEAD -> ");
    const name = raw.replace(/^HEAD -> /, "").replace(/^tag: /, "");
    const kind = raw.startsWith("tag: ") ? "tag" : head || name === "HEAD" || branches.includes(name) ? "branch" : "remote";
    return { raw, name, kind, head };
  });
}

/** Branch, remote and tag names pointing at a commit; the checked-out branch stands out. */
@Component({
  selector: "gd-ref-chips",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: "display: contents" },
  template: `
    @for (ref of chips(); track ref.raw) {
      <span class="ref-chip ref-{{ ref.kind }}" [class.is-head]="ref.head">{{ ref.name }}</span>
    }
  `,
})
export class RefChips {
  readonly refs = input.required<readonly string[]>();
  private readonly session = inject(Session);
  protected readonly chips = computed(() => parseRefs(this.refs(), this.session.snapshot()?.branches ?? []));
}
