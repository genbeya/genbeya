/**
 * Guided tours: a popover that walks through parts of the app one step at a
 * time, with the part each step explains highlighted. The tour knows nothing
 * about the parts; steps name them by selector. Steps whose element is
 * missing (a view without content, a feature this build lacks) are skipped.
 */
import { ApplicationRef, type ComponentRef, createComponent, EnvironmentInjector, Injectable, inject, signal } from "@angular/core";
import { isActive, Router } from "@angular/router";
import type { TourPlacement } from "./tour-placement";

export interface TourStep {
  /** CSS selector of the element the step explains, usually a `[data-tour=…]` attribute. */
  readonly target: string;
  readonly title: string;
  /** A sentence or two of Markdown. */
  readonly body: string;
  /** The preferred side of the element; the popover moves to another when this one has no room. */
  readonly placement?: TourPlacement;
  /** The router URL the element is on; the tour goes there first, unless the path is shown already. */
  readonly route?: string;
  /** Something to try right away, such as "Press Ctrl+K". */
  readonly tryIt?: string;
}

/** The step on screen. */
export interface TourPosition {
  readonly step: TourStep;
  /** Among all steps of the tour, skipped ones included. */
  readonly index: number;
  readonly count: number;
}

/** "completed" after the last step, "ended" when the user ended the tour before. */
export type TourEnd = "completed" | "ended";

/** How long a step waits for its element, in ms: after a route change its view loads first. */
export const TARGET_WAIT = { route: 3000, inPlace: 300 } as const;
const POLL = 50;

/** The first element `selector` names that is on screen, or null. */
export function findTarget(selector: string): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>(selector)) if (element.getClientRects().length) return element;
  return null;
}

/** Scrolls an element that is not wholly in the window to its middle; at once when the user prefers less motion. */
function reveal(element: HTMLElement) {
  const { top, bottom, left, right } = element.getBoundingClientRect();
  if (top >= 0 && left >= 0 && bottom <= innerHeight && right <= innerWidth) return;
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  element.scrollIntoView?.({ block: "center", inline: "nearest", behavior: reduced ? "auto" : "smooth" });
}

async function waitForTarget(selector: string, ms: number): Promise<HTMLElement | null> {
  const deadline = Date.now() + ms;
  for (;;) {
    const element = findTarget(selector);
    if (element || Date.now() >= deadline) return element;
    await new Promise((resolve) => setTimeout(resolve, POLL));
  }
}

@Injectable({ providedIn: "root" })
export class Tour {
  private readonly router = inject(Router);
  private readonly appRef = inject(ApplicationRef);
  private readonly injector = inject(EnvironmentInjector);
  private readonly position = signal<TourPosition | null>(null);
  private readonly searching = signal(false);
  private steps: readonly TourStep[] = [];
  private finish: ((end: TourEnd) => void) | null = null;
  private layer: ComponentRef<unknown> | null = null;
  /** Counts moves, so a step found late never replaces a newer one. */
  private moves = 0;
  private returnFocus: Element | null = null;

  /** The step on screen; null without a tour. */
  readonly current = this.position.asReadonly();
  /** True while the tour looks for the next step's element. */
  readonly moving = this.searching.asReadonly();

  /** Runs a tour; resolves to how it ended. A tour that is running ends first. */
  async start(steps: readonly TourStep[]): Promise<TourEnd> {
    this.end("ended");
    this.steps = steps;
    this.returnFocus = document.activeElement;
    const ended = new Promise<TourEnd>((resolve) => (this.finish = resolve));
    const started = this.moves;
    await this.mount();
    // Unless the tour ended while its layer loaded.
    if (this.moves === started) void this.go(0, 1);
    return ended;
  }

  next(): void {
    const position = this.position();
    if (position && !this.searching()) void this.go(position.index + 1, 1);
  }

  back(): void {
    const position = this.position();
    if (position && position.index > 0 && !this.searching()) void this.go(position.index - 1, -1);
  }

  /** Ends the tour before its last step. */
  stop(): void {
    this.end("ended");
  }

  /** Shows the first step from `from` on, in `direction`, whose element is there. */
  private async go(from: number, direction: 1 | -1): Promise<void> {
    const move = ++this.moves;
    const current = this.position()?.index;
    this.searching.set(true);
    for (let index = from; index >= 0 && index < this.steps.length; index += direction) {
      const step = this.steps[index]!;
      // Already there, the view keeps what it shows (the open page, say).
      if (step.route && !isActive(step.route, this.router, { paths: "exact" })())
        await this.router.navigateByUrl(step.route).catch(() => false);
      const target = await waitForTarget(step.target, step.route ? TARGET_WAIT.route : TARGET_WAIT.inPlace);
      if (move !== this.moves) return;
      if (target) {
        // The layer follows the element as it scrolls.
        reveal(target);
        this.position.set({ step, index, count: this.steps.length });
        this.searching.set(false);
        return;
      }
    }
    if (direction === 1) this.end("completed");
    // Nothing before the current step is there; it shows again, on its own route.
    else if (current !== undefined) void this.go(current, 1);
  }

  private end(how: TourEnd) {
    const finish = this.finish;
    if (!finish) return;
    this.finish = null;
    this.moves++;
    this.position.set(null);
    this.searching.set(false);
    this.unmount();
    if (this.returnFocus instanceof HTMLElement && this.returnFocus.isConnected) this.returnFocus.focus();
    finish(how);
  }

  /** The layer showing the tour, a separate chunk, on top of the app but below its dialogs. */
  private async mount() {
    if (this.layer) return;
    const { TourLayer } = await import("./tour-layer");
    if (!this.finish || this.layer) return;
    this.layer = createComponent(TourLayer, { environmentInjector: this.injector });
    this.appRef.attachView(this.layer.hostView);
    document.body.append(this.layer.location.nativeElement as HTMLElement);
  }

  private unmount() {
    const layer = this.layer;
    if (!layer) return;
    this.layer = null;
    const element = layer.location.nativeElement as HTMLElement;
    this.appRef.detachView(layer.hostView);
    layer.destroy();
    element.remove();
  }
}
