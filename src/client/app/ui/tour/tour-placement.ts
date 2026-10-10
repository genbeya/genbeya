/** Where a tour's popover goes: beside its element, on the side with room, always inside the window. */

export type TourPlacement = "top" | "bottom" | "left" | "right";

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Box extends Size {
  readonly left: number;
  readonly top: number;
}

export interface Placed {
  readonly left: number;
  readonly top: number;
  /** "center" without an element to point at. */
  readonly placement: TourPlacement | "center";
}

/** Between the element and the popover. */
export const GAP = 12;
/** Between the popover and the window's edge. */
export const MARGIN = 12;
const SIDES: readonly TourPlacement[] = ["bottom", "right", "top", "left"];

const clamp = (value: number, size: number, room: number) => Math.max(MARGIN, Math.min(value, room - size - MARGIN));

/**
 * Places `popover` next to `target`: on the `preferred` side if it fits
 * there, else on the first side in {@link SIDES} that fits, else on the side
 * with the most room, overlapping the element. Centred without a target.
 */
export function placePopover(target: Box | null, popover: Size, viewport: Size, preferred?: TourPlacement): Placed {
  if (!target)
    return {
      left: clamp((viewport.width - popover.width) / 2, popover.width, viewport.width),
      top: clamp((viewport.height - popover.height) / 2, popover.height, viewport.height),
      placement: "center",
    };
  const right = target.left + target.width;
  const bottom = target.top + target.height;
  const room: Record<TourPlacement, number> = {
    top: target.top - GAP - MARGIN - popover.height,
    bottom: viewport.height - bottom - GAP - MARGIN - popover.height,
    left: target.left - GAP - MARGIN - popover.width,
    right: viewport.width - right - GAP - MARGIN - popover.width,
  };
  const sides = preferred ? [preferred, ...SIDES.filter((side) => side !== preferred)] : SIDES;
  const placement = sides.find((side) => room[side] >= 0) ?? sides.reduce((best, side) => (room[side] > room[best] ? side : best));
  const centreX = target.left + target.width / 2 - popover.width / 2;
  const centreY = target.top + target.height / 2 - popover.height / 2;
  const [left, top] = {
    top: [centreX, target.top - GAP - popover.height],
    bottom: [centreX, bottom + GAP],
    left: [target.left - GAP - popover.width, centreY],
    right: [right + GAP, centreY],
  }[placement];
  return {
    left: clamp(left!, popover.width, viewport.width),
    top: clamp(top!, popover.height, viewport.height),
    placement,
  };
}
