import { LiveAnnouncer } from "@angular/cdk/a11y";
import { Dialog } from "@angular/cdk/dialog";
import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  type ElementRef,
  inject,
  signal,
  viewChild,
  ViewEncapsulation,
} from "@angular/core";
import { LucideMousePointerClick, LucideX } from "@lucide/angular";
import { ExternalLinks } from "../../core/external-links";
import { isTyping } from "../../core/hotkeys";
import type { LinkTarget } from "../../markdown/link-target";
import { MarkdownView } from "../../markdown/markdown-view";
import { findTarget, Tour } from "./tour";
import { placePopover, type Box, type Placed } from "./tour-placement";

/** Room between the element and its highlight. */
const PADDING = 4;
/** Until the popover has been measured. */
const DEFAULT_SIZE = { width: 340, height: 180 };

const sameBox = (a: Box | null, b: Box | null) =>
  a === b || (!!a && !!b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height);

/**
 * The tour on screen: a highlight around the step's element, the rest dimmed,
 * and the popover beside it. It follows the element as the window resizes or
 * the layout changes. Everything stays usable, so the user can try things out.
 * Lives outside the overlay container, where the app's shortcuts still work.
 */
@Component({
  selector: "gd-tour-layer",
  imports: [MarkdownView, LucideMousePointerClick, LucideX],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Global but namespaced, so the rendered Markdown inside is styled too.
  encapsulation: ViewEncapsulation.None,
  styleUrl: "./tour.css",
  host: { class: "tour-layer", "[class.is-moving]": "tour.moving()" },
  template: `
    @if (tour.current(); as position) {
      @if (spot(); as box) {
        <div
          class="tour-spotlight"
          aria-hidden="true"
          [style.left.px]="box.left"
          [style.top.px]="box.top"
          [style.width.px]="box.width"
          [style.height.px]="box.height"
        ></div>
      } @else {
        <div class="tour-dim" aria-hidden="true"></div>
      }
      <section
        #popover
        class="tour-popover"
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        [attr.data-placement]="placed().placement"
        [style.left.px]="placed().left"
        [style.top.px]="placed().top"
        (keydown)="key($event)"
      >
        <header>
          <span class="tour-count">{{ position.index + 1 }} of {{ position.count }}</span>
          <button type="button" class="icon-btn" aria-label="End the tour" title="End the tour (Esc)" (click)="tour.stop()">
            <svg lucideX [size]="15" aria-hidden="true"></svg>
          </button>
        </header>
        <h2 id="tour-title">{{ position.step.title }}</h2>
        <gd-markdown id="tour-body" class="tour-body" [source]="position.step.body" path="" (linkClicked)="follow($event)" />
        @if (position.step.tryIt; as tryIt) {
          <p class="tour-try"><svg lucideMousePointerClick [size]="14" aria-hidden="true"></svg>{{ tryIt }}</p>
        }
        <footer>
          <button type="button" class="btn btn-ghost btn-m" (click)="tour.stop()"><span>Skip tour</span></button>
          <span class="grow"></span>
          @if (position.index > 0) {
            <button type="button" class="btn btn-default btn-m" (click)="tour.back()"><span>Back</span></button>
          }
          <button #next type="button" class="btn btn-primary btn-m" (click)="tour.next()">
            <span>{{ position.index === position.count - 1 ? "Done" : "Next" }}</span>
          </button>
        </footer>
      </section>
    }
  `,
})
export class TourLayer {
  protected readonly tour = inject(Tour);
  private readonly links = inject(ExternalLinks);
  private readonly dialog = inject(Dialog);
  private readonly popover = viewChild<ElementRef<HTMLElement>>("popover");
  private readonly nextButton = viewChild<ElementRef<HTMLButtonElement>>("next");
  /** The highlighted area, null when the element is gone (the user went elsewhere). */
  protected readonly spot = signal<Box | null>(null);
  protected readonly placed = signal<Placed>(placePopover(null, DEFAULT_SIZE, { width: innerWidth, height: innerHeight }));

  constructor() {
    // Elements move with resizes, scrolling, panels opening and data arriving; follow them every frame.
    const track = () => {
      this.measure();
      frame = requestAnimationFrame(track);
    };
    let frame = requestAnimationFrame(track);
    const escape = (event: KeyboardEvent) => this.escape(event);
    addEventListener("keydown", escape);
    inject(DestroyRef).onDestroy(() => {
      cancelAnimationFrame(frame);
      removeEventListener("keydown", escape);
    });

    // Each step takes the focus and is announced, for keyboards and screen readers.
    const announcer = inject(LiveAnnouncer);
    afterRenderEffect(() => {
      const position = this.tour.current();
      if (!position || this.tour.moving()) return;
      this.measure();
      this.nextButton()?.nativeElement.focus({ preventScroll: true });
      void announcer.announce(`${position.step.title}. Step ${position.index + 1} of ${position.count}.`);
    });
  }

  protected key(event: KeyboardEvent) {
    const actions: Partial<Record<string, () => void>> = {
      Escape: () => this.tour.stop(),
      ArrowRight: () => this.tour.next(),
      ArrowLeft: () => this.tour.back(),
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    action();
  }

  protected follow(target: LinkTarget) {
    if (target.kind === "external") void this.links.open(target.url);
  }

  /** Escape outside the popover ends the tour, unless a dialog, menu or field had a use for it. */
  private escape(event: KeyboardEvent) {
    if (event.key !== "Escape" || event.defaultPrevented || this.dialog.openDialogs.length) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest?.(".cdk-overlay-container") || isTyping(target)) return;
    this.tour.stop();
  }

  private measure() {
    const position = this.tour.current();
    const rect = position && findTarget(position.step.target)?.getBoundingClientRect();
    const viewport = { width: innerWidth, height: innerHeight };
    const spot = rect
      ? {
          left: Math.max(0, rect.left - PADDING),
          top: Math.max(0, rect.top - PADDING),
          width: Math.min(viewport.width, rect.right + PADDING) - Math.max(0, rect.left - PADDING),
          height: Math.min(viewport.height, rect.bottom + PADDING) - Math.max(0, rect.top - PADDING),
        }
      : null;
    if (!sameBox(spot, this.spot())) this.spot.set(spot);
    const popover = this.popover()?.nativeElement;
    const size = popover?.offsetWidth ? { width: popover.offsetWidth, height: popover.offsetHeight } : DEFAULT_SIZE;
    const placed = placePopover(spot, size, viewport, position?.step.placement);
    const before = this.placed();
    if (placed.left !== before.left || placed.top !== before.top || placed.placement !== before.placement) this.placed.set(placed);
  }
}
