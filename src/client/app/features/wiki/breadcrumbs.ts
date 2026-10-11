import { ChangeDetectionStrategy, Component, computed, inject, input } from "@angular/core";
import { Session } from "../../core/session";
import { Icon } from "../../ui/icon";
import { WikiActions } from "./wiki-actions";
import { findPage, nodeKey } from "./wiki-pages";

/** The pages above a page or folder, each a link, then its own title. */
@Component({
  selector: "gd-breadcrumbs",
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "view-title" },
  template: `
    @for (node of trail(); track key(node)) {
      <span class="row crumb-row">
        <button type="button" class="crumb plain" (click)="wiki.openNode(node)">{{ node.title }}</button>
        <svg gd-icon name="chevron-right" [size]="13" class="crumb-sep"></svg>
      </span>
    }
    <span class="ellipsis">{{ title() }}</span>
  `,
  styles: `
    .crumb-row {
      gap: 6px;
    }
  `,
})
export class Breadcrumbs {
  readonly path = input.required<string>();
  private readonly session = inject(Session);
  protected readonly wiki = inject(WikiActions);
  private readonly found = computed(() => findPage(this.session.snapshot()?.wiki ?? [], this.path()));
  protected readonly trail = computed(() => this.found()?.trail ?? []);
  protected readonly title = computed(() => this.found()?.node.title ?? this.path().split("/").pop()!.replace(/\.md$/, ""));
  protected readonly key = nodeKey;
}
