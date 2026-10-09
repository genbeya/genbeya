import { ChangeDetectionStrategy, Component, input } from "@angular/core";

/** A centred message for empty views; project an icon with the `icon` attribute and any text or actions. */
@Component({
  selector: "gd-empty-state",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "empty-state" },
  template: `
    <div class="empty-icon"><ng-content select="[icon]" /></div>
    <h3>{{ title() }}</h3>
    <ng-content />
  `,
})
export class EmptyState {
  readonly title = input.required<string>();
}
