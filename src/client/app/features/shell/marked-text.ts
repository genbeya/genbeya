import { ChangeDetectionStrategy, Component, input } from "@angular/core";
import type { Segment } from "./search-items";

/** A line of text with the parts that matched a search highlighted. */
@Component({
  selector: "gd-marked-text",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "ellipsis" },
  template: `
    @for (segment of segments(); track $index) {
      @if (segment.mark) {
        <mark>{{ segment.text }}</mark>
      } @else {
        <span>{{ segment.text }}</span>
      }
    }
  `,
  styles: `
    mark {
      border-radius: 2px;
      background: var(--yellow-soft);
      color: inherit;
      box-shadow: 0 0 0 1px var(--yellow);
    }
  `,
})
export class MarkedText {
  readonly segments = input.required<readonly Segment[]>();
}
