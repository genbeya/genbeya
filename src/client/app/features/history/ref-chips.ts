import { ChangeDetectionStrategy, Component, computed, input } from "@angular/core";

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
  protected readonly chips = computed(() =>
    this.refs().map((raw) => {
      const head = raw.startsWith("HEAD -> ");
      const name = raw.replace(/^HEAD -> /, "").replace(/^tag: /, "");
      const kind = raw.startsWith("tag: ") ? "tag" : name.includes("/") && !head ? "remote" : "branch";
      return { raw, head, name, kind };
    }),
  );
}
