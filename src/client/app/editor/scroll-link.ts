/**
 * Keeps an editor and its preview at the same source line while both are
 * shown: whichever the user scrolls leads, and the other follows. A side that
 * was just moved to follow ignores its own scroll events for a moment, so the
 * two never chase each other.
 */
export type Side = "editor" | "preview";

/** How long a following side's scroll events are taken as the echo of being moved. */
const ECHO = 120;

export class ScrollLink {
  private following: Side | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** `side` was scrolled: `follow` moves the other one, unless `side` only moved because it follows. */
  moved(side: Side, follow: () => void): void {
    if (this.following === side) return this.settle();
    this.following = side === "editor" ? "preview" : "editor";
    follow();
    this.settle();
  }

  private settle() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => (this.following = null), ECHO);
  }
}
