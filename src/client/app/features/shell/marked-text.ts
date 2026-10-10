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
})
export class MarkedText {
  readonly segments = input.required<readonly Segment[]>();
}
