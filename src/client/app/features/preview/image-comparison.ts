import { ChangeDetectionStrategy, Component, computed, input, signal, type ElementRef, viewChild } from "@angular/core";
import { dataUrlBytes, imageFacts, type PixelSize } from "./file-size";
import { ImagePreview } from "./image-preview";

/** How two versions of an image are compared: next to each other, or on top of each other with a divider to drag. */
export type ImageComparisonMode = "sides" | "swipe";

/** How far the arrow keys move the divider, in percent of the image's width. */
const STEP = 5;

/**
 * Two versions of an image: side by side, each with its pixel size and
 * file size, or swiped, where the version before shows left of a divider
 * and the version after right of it. Swiping needs both versions.
 */
@Component({
  selector: "gd-image-comparison",
  imports: [ImagePreview],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "content-scroll image-comparison" },
  template: `
    @if (mode() === "swipe" && original() && modified()) {
      <div class="swipe-facts">
        <span><span class="side-label">Before</span> {{ facts()[0] }}</span>
        <span><span class="side-label">After</span> {{ facts()[1] }}</span>
      </div>
      <div
        #stage
        class="swipe"
        [style.width.px]="stageWidth()"
        (pointerdown)="grab($event)"
        (pointermove)="drag($event)"
        (pointerup)="release($event)"
        (pointercancel)="release($event)"
      >
        <img class="swipe-before" [src]="original()" [alt]="name() + ' before'" [style.width.%]="share(0)" (load)="measure(0, $event)" />
        <img
          class="swipe-after"
          [src]="modified()"
          [alt]="name() + ' after'"
          [style.width.%]="share(1)"
          [style.clip-path]="'inset(0 0 0 ' + divider() + '%)'"
          (load)="measure(1, $event)"
        />
        <div
          class="swipe-divider"
          role="slider"
          tabindex="0"
          aria-label="Divider between before and after"
          aria-valuemin="0"
          aria-valuemax="100"
          [attr.aria-valuenow]="divider()"
          [attr.aria-valuetext]="divider() + '% before'"
          [style.left.%]="divider()"
          (keydown)="key($event)"
        >
          <span class="swipe-handle"></span>
        </div>
      </div>
    } @else {
      <div class="sides">
        @for (side of sides(); track side.label; let i = $index) {
          <figure class="side">
            <figcaption>
              <span class="side-label">{{ side.label }}</span>
              <span class="side-facts">{{ side.url ? facts()[i] : "No file" }}</span>
            </figcaption>
            @if (side.url) {
              <gd-image-preview [src]="side.url" [alt]="name() + ' ' + side.label.toLowerCase()" (measured)="sized(i, $event)" />
            } @else {
              <p class="side-missing">Not in this version</p>
            }
          </figure>
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
      padding: 20px 24px;
    }
    .sides {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 24px;
      align-items: start;
    }
    .side {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin: 0;
      min-width: 0;
    }
    figcaption,
    .swipe-facts {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 2px 8px;
      color: var(--text-3);
      font-size: 12px;
      font-variant-numeric: tabular-nums;
    }
    .swipe-facts {
      justify-content: center;
      column-gap: 24px;
      margin-bottom: 10px;
    }
    .side-label {
      color: var(--text-2);
      font-weight: 500;
    }
    .side-missing {
      margin: 0;
      padding: 32px 0;
      color: var(--text-3);
      font-size: 12.5px;
      text-align: center;
    }
    .swipe {
      position: relative;
      display: grid;
      max-width: 100%;
      margin: 0 auto;
      touch-action: none;
      cursor: ew-resize;
      user-select: none;
      background: repeating-conic-gradient(var(--bg-hover) 0 25%, transparent 0 50%) 0 0 / 16px 16px;
    }
    .swipe img {
      grid-area: 1 / 1;
      height: auto;
      pointer-events: none;
    }
    .swipe-divider {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 2px;
      margin-left: -1px;
      background: var(--accent);
      outline: none;
    }
    .swipe-handle {
      position: absolute;
      top: 50%;
      left: 50%;
      width: 14px;
      height: 28px;
      border: 2px solid var(--accent);
      border-radius: var(--radius-s);
      background: var(--bg-panel);
      transform: translate(-50%, -50%);
    }
    .swipe-divider:focus-visible .swipe-handle {
      box-shadow: 0 0 0 3px var(--accent-soft);
    }
  `,
})
export class ImageComparison {
  /** The version before as a data URL; null when it has no file. */
  readonly original = input.required<string | null>();
  /** The version after as a data URL; null when it has no file. */
  readonly modified = input.required<string | null>();
  readonly mode = input<ImageComparisonMode>("sides");
  /** The file's name, for the images' descriptions. */
  readonly name = input("Image");

  /** Where the divider stands, in percent of the width from the left. */
  protected readonly divider = signal(50);
  private readonly pixels = signal<readonly [PixelSize | null, PixelSize | null]>([null, null]);
  private readonly stage = viewChild<ElementRef<HTMLElement>>("stage");
  private dragging = false;

  protected readonly sides = computed(() => [
    { label: "Before", url: this.original() },
    { label: "After", url: this.modified() },
  ]);
  protected readonly facts = computed(() => {
    const pixels = this.pixels();
    return [this.original(), this.modified()].map((url, i) => (url ? imageFacts(pixels[i]!, dataUrlBytes(url)) : ""));
  });
  /** Both versions at the same scale: as wide as the wider one, at most as wide as the space. */
  protected readonly stageWidth = computed(() => {
    const [before, after] = this.pixels();
    return before && after ? Math.max(before.width, after.width) : null;
  });

  /** A version's width in percent of the stage, so both keep their sizes relative to each other. */
  protected share(side: 0 | 1): number | null {
    const width = this.stageWidth();
    const size = this.pixels()[side];
    return width && size ? (size.width / width) * 100 : null;
  }

  protected sized(side: number, size: PixelSize) {
    this.pixels.update((pixels) => (side === 0 ? [size, pixels[1]] : [pixels[0], size]));
  }

  protected measure(side: number, event: Event) {
    const image = event.target as HTMLImageElement;
    this.sized(side, { width: image.naturalWidth, height: image.naturalHeight });
  }

  protected grab(event: PointerEvent) {
    this.dragging = true;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    this.moveTo(event.clientX);
  }

  protected drag(event: PointerEvent) {
    if (this.dragging) this.moveTo(event.clientX);
  }

  protected release(event: PointerEvent) {
    this.dragging = false;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
  }

  protected key(event: KeyboardEvent) {
    const moves: Record<string, (at: number) => number> = {
      ArrowLeft: (at) => at - STEP,
      ArrowDown: (at) => at - STEP,
      ArrowRight: (at) => at + STEP,
      ArrowUp: (at) => at + STEP,
      Home: () => 0,
      End: () => 100,
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    this.divider.update((at) => Math.min(100, Math.max(0, move(at))));
  }

  private moveTo(x: number) {
    const bounds = this.stage()?.nativeElement.getBoundingClientRect();
    if (!bounds?.width) return;
    this.divider.set(Math.round(Math.min(100, Math.max(0, ((x - bounds.left) / bounds.width) * 100))));
  }
}
