import { ChangeDetectionStrategy, Component, computed, input } from "@angular/core";
import type { GraphRow } from "./commit-graph";

export const LANE_WIDTH = 14;
export const ROW_HEIGHT = 44;
const COLORS = ["var(--accent)", "var(--green)", "var(--orange)", "var(--blue)", "var(--purple)", "var(--yellow)", "var(--red)"];

const colorOf = (lane: number) => COLORS[lane % COLORS.length]!;
const xOf = (lane: number) => 12 + lane * LANE_WIDTH;
/** A vertical line, or an S-curve between lanes. */
const curve = (x1: number, y1: number, x2: number, y2: number) =>
  x1 === x2 ? `M${x1} ${y1}V${y2}` : `M${x1} ${y1}C${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}`;

/** One row of the commit graph: passing lines, lines into and out of the dot, and the dot. */
@Component({
  selector: "gd-graph-lines",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: "display: contents" },
  template: `
    <svg class="graph" [attr.width]="width()" [attr.height]="height" aria-hidden="true">
      @for (line of lines(); track $index) {
        <path [attr.d]="line.d" [attr.stroke]="line.color" />
      }
      <circle
        [attr.cx]="dot().x"
        [attr.cy]="height / 2"
        [attr.r]="dot().merge ? 4.5 : 3.5"
        [attr.fill]="dot().merge ? 'var(--bg-panel)' : dot().color"
        [attr.stroke]="dot().color"
        stroke-width="2"
      />
    </svg>
  `,
})
export class GraphLines {
  readonly row = input.required<GraphRow>();
  readonly width = input.required<number>();
  protected readonly height = ROW_HEIGHT;
  protected readonly lines = computed(() => {
    const { lane, into, through, out } = this.row();
    const middle = ROW_HEIGHT / 2;
    return [
      ...through.map(([from, to]) => ({ d: curve(xOf(from), 0, xOf(to), ROW_HEIGHT), color: colorOf(from) })),
      ...into.map((from) => ({ d: curve(xOf(from), 0, xOf(lane), middle), color: colorOf(from) })),
      ...out.map((to) => ({ d: curve(xOf(lane), middle, xOf(to), ROW_HEIGHT), color: colorOf(to) })),
    ];
  });
  protected readonly dot = computed(() => {
    const { lane, commit } = this.row();
    return { x: xOf(lane), color: colorOf(lane), merge: commit.parents.length > 1 };
  });
}
