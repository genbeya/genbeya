/**
 * An image or diagram of a page, over the window: fitted at first, then
 * zoomed with the wheel, a pinch or the keys, and moved by dragging.
 * Diagrams can show their source beside the picture or instead of it.
 */
import { DIALOG_DATA } from "@angular/cdk/dialog";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  type ElementRef,
  inject,
  signal,
  untracked,
  viewChild,
} from "@angular/core";
import type { Dialogs } from "../core/dialogs";
import { isTyping } from "../core/hotkeys";
import { CodeEditor } from "../editor/code-editor";
import { DialogFrame } from "../ui/dialog-frame";
import { Icon } from "../ui/icon";
import type { IconName } from "../ui/icon-data";

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** How the picture lies on the stage: its zoom, and where its top left corner is. */
export interface View extends Point {
  readonly scale: number;
}

export interface ZoomedPicture {
  /** Names the popup, such as "Mermaid diagram" or an image's description. */
  readonly title: string;
  /**
   * An image by its URL, which stays valid while the popup is open; or a drawn
   * diagram's SVG, which the popup shows from a URL of its own, so the page
   * may render again meanwhile.
   */
  readonly image: { readonly url: string; readonly vector: boolean } | { readonly svg: string };
  /** The size the page shows it at, for pictures without a size of their own. */
  readonly shown: Size;
  /** A diagram's source; images from the repository have none. */
  readonly source?: { readonly language: "mermaid" | "plantuml"; readonly text: string };
}

type Mode = "source" | "split" | "diagram";

const MODES: readonly { readonly mode: Mode; readonly label: string; readonly icon: IconName }[] = [
  { mode: "source", label: "Source", icon: "code-xml" },
  { mode: "split", label: "Split", icon: "columns-2" },
  { mode: "diagram", label: "Diagram", icon: "eye" },
];

/** Space around a fitted picture. */
const MARGIN = 24;
/** Raster images blur when enlarged further; SVG stays sharp, this only keeps it to a size the browser can draw. */
const RASTER_LIMIT = 4;
const VECTOR_LIMIT = 16;
/** One step of the keys and buttons. */
const STEP = 1.25;
/** How far the arrow keys move the picture. */
const NUDGE = 48;
/** What stays on the stage of a picture moved to its edge. */
const KEEP_VISIBLE = 48;

/** The zoom that shows all of `picture` on `stage`, but never enlarges it. */
export function fitScale(picture: Size, stage: Size): number {
  const width = Math.max(1, stage.width - 2 * MARGIN);
  const height = Math.max(1, stage.height - 2 * MARGIN);
  return Math.min(1, width / picture.width, height / picture.height);
}

/** `picture` at `scale`, centred on `stage`. */
export function centred(picture: Size, stage: Size, scale: number): View {
  return { scale, x: (stage.width - picture.width * scale) / 2, y: (stage.height - picture.height * scale) / 2 };
}

/** `view` zoomed to `scale`, keeping the picture's spot under `point` where it is. */
export function zoomedAround(view: View, scale: number, point: Point): View {
  const ratio = scale / view.scale;
  return { scale, x: point.x - (point.x - view.x) * ratio, y: point.y - (point.y - view.y) * ratio };
}

/** `view` with a strip of the picture left on the stage, however far it was moved. */
export function keptInView(view: View, picture: Size, stage: Size): View {
  const clamp = (value: number, size: number, room: number) => {
    const kept = Math.min(KEEP_VISIBLE, size, room);
    return Math.min(Math.max(value, kept - size), room - kept);
  };
  return {
    ...view,
    x: clamp(view.x, picture.width * view.scale, stage.width),
    y: clamp(view.y, picture.height * view.scale, stage.height),
  };
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Opens `picture` over the window; resolves once it is closed. */
export async function openImageZoom(dialogs: Dialogs, picture: ZoomedPicture): Promise<void> {
  await dialogs.open(ImageZoom, picture, { top: `${MARGIN}px`, panel: "zoom-pane", backdrop: "zoom-backdrop" });
}

@Component({
  selector: "gd-image-zoom",
  imports: [CodeEditor, DialogFrame, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "image-zoom", "(keydown)": "key($event)" },
  template: `
    <gd-dialog-frame [title]="picture.title" [width]="null">
      <div actions class="zoom-tools">
        @if (picture.source) {
          <div class="segmented" role="radiogroup" aria-label="Show">
            @for (choice of modes; track choice.mode) {
              <button
                type="button"
                role="radio"
                [attr.aria-checked]="mode() === choice.mode"
                [class.is-active]="mode() === choice.mode"
                (click)="mode.set(choice.mode)"
              >
                <svg gd-icon [name]="choice.icon" [size]="12"></svg> {{ choice.label }}
              </button>
            }
          </div>
        }
        @if (showsPicture()) {
          <span class="zoom-buttons">
            <button type="button" class="icon-btn" aria-label="Zoom out" title="Zoom out (−)" [disabled]="atMinimum()" (click)="step(-1)">
              <svg gd-icon name="zoom-out" [size]="15"></svg>
            </button>
            <span class="zoom-level">{{ percent() }} %</span>
            <button type="button" class="icon-btn" aria-label="Zoom in" title="Zoom in (+)" [disabled]="atMaximum()" (click)="step(1)">
              <svg gd-icon name="zoom-in" [size]="15"></svg>
            </button>
            <button type="button" class="icon-btn" aria-label="Fit to window" title="Fit to window (0)" (click)="fit(true)">
              <svg gd-icon name="scan" [size]="15"></svg>
            </button>
            <button type="button" class="btn btn-default btn-s" title="Actual size (1)" (click)="actualSize(null, true)">
              <span>100 %</span>
            </button>
          </span>
        }
      </div>
      <div class="zoom-body" [class.is-split]="showsSource() && showsPicture()">
        @if (showsSource() && picture.source; as source) {
          <gd-code-editor
            class="zoom-source"
            [value]="source.text"
            [path]="source.language === 'mermaid' ? 'diagram.mmd' : 'diagram.puml'"
            [readOnly]="true"
            [label]="'Source of the ' + picture.title"
          />
        }
        @if (showsPicture()) {
          <div
            #stage
            class="zoom-stage"
            tabindex="0"
            cdkFocusInitial
            role="img"
            [attr.aria-label]="picture.title"
            aria-describedby="zoom-hint"
            [class.is-dragging]="dragging()"
            (wheel)="wheel($event)"
            (pointerdown)="pointerDown($event)"
            (pointermove)="pointerMove($event)"
            (pointerup)="pointerUp($event)"
            (pointercancel)="pointerUp($event)"
            (pointerleave)="pointer = null"
          >
            <img
              [src]="url"
              alt=""
              draggable="false"
              [class.is-ready]="natural()"
              [class.is-animated]="animated()"
              [style.width.px]="displayed()?.width"
              [style.height.px]="displayed()?.height"
              [style.transform]="'translate(' + view().x + 'px, ' + view().y + 'px)'"
              (load)="loaded($event)"
            />
          </div>
          <span id="zoom-hint" class="sr-only"
            >Drag it or use the arrow keys to move it; + and − zoom, 0 fits it to the window, 1 shows it at 100 %.</span
          >
        }
      </div>
    </gd-dialog-frame>
  `,
  styles: `
    .zoom-tools {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 0 6px 0 auto;
    }
    .zoom-buttons {
      display: flex;
      align-items: center;
      gap: 2px;
    }
    .zoom-buttons .btn {
      margin-left: 4px;
    }
    .zoom-level {
      min-width: 48px;
      color: var(--text-2);
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      text-align: center;
    }
    .zoom-body {
      display: flex;
      flex: 1;
      min-height: 0;
      border-top: 1px solid var(--line);
    }
    .zoom-body > * {
      flex: 1;
      min-width: 0;
    }
    .zoom-body.is-split {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
    .zoom-body.is-split .zoom-stage {
      border-left: 1px solid var(--line);
    }
    .zoom-stage {
      position: relative;
      overflow: hidden;
      background: var(--bg-code);
      cursor: grab;
      touch-action: none;
      user-select: none;
    }
    .zoom-stage:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: -2px;
    }
    .zoom-stage.is-dragging {
      cursor: grabbing;
    }
    .zoom-stage img {
      position: absolute;
      top: 0;
      left: 0;
      max-width: none;
      visibility: hidden;
      transform-origin: 0 0;
    }
    .zoom-stage img.is-ready {
      visibility: visible;
    }
    .zoom-stage img.is-animated {
      transition:
        width 120ms ease-out,
        height 120ms ease-out,
        transform 120ms ease-out;
    }
    @media (prefers-reduced-motion: reduce) {
      .zoom-stage img.is-animated {
        transition: none;
      }
    }
  `,
})
export class ImageZoom {
  protected readonly picture = inject<ZoomedPicture>(DIALOG_DATA);
  protected readonly modes = MODES;
  /** Diagrams open on the picture. */
  protected readonly mode = signal<Mode>("diagram");
  protected readonly showsSource = computed(() => !!this.picture.source && this.mode() !== "diagram");
  protected readonly showsPicture = computed(() => !this.picture.source || this.mode() !== "source");
  protected readonly url: string;
  private readonly vector: boolean;

  private readonly stage = viewChild<ElementRef<HTMLElement>>("stage");
  /** The picture's own size, once it has loaded. */
  protected readonly natural = signal<Size | null>(null);
  private readonly stageSize = signal<Size | null>(null);
  protected readonly view = signal<View>({ scale: 1, x: 0, y: 0 });
  /** Steps of the keys and buttons glide; the wheel, dragging and pinching follow the hand. */
  protected readonly animated = signal(false);
  protected readonly dragging = signal(false);
  /** Until the user zooms or moves it, the picture stays fitted, also when the window changes. */
  private adjusted = false;
  /** Where the pointer is on the stage, for the keys to zoom around. */
  protected pointer: Point | null = null;
  private readonly pointers = new Map<number, Point>();

  protected readonly displayed = computed<Size | null>(() => {
    const natural = this.natural();
    const { scale } = this.view();
    return natural && { width: natural.width * scale, height: natural.height * scale };
  });
  private readonly fitted = computed(() => {
    const natural = this.natural();
    const stage = this.stageSize();
    return natural && stage ? fitScale(natural, stage) : 1;
  });
  private readonly minimum = computed(() => Math.min(this.fitted(), 1) / 2);
  private readonly maximum = computed(() => Math.max(this.fitted(), this.vector ? VECTOR_LIMIT : RASTER_LIMIT));
  protected readonly atMinimum = computed(() => this.view().scale <= this.minimum() + 1e-9);
  protected readonly atMaximum = computed(() => this.view().scale >= this.maximum() - 1e-9);
  protected readonly percent = computed(() => Math.round(this.view().scale * 100));

  constructor() {
    const { image } = this.picture;
    this.vector = "svg" in image || image.vector;
    this.url = "svg" in image ? URL.createObjectURL(new Blob([image.svg], { type: "image/svg+xml" })) : image.url;
    const observer = new ResizeObserver(() => this.measure());
    effect((onCleanup) => {
      const stage = this.stage()?.nativeElement;
      if (!stage) return;
      observer.observe(stage);
      untracked(() => this.measure());
      onCleanup(() => observer.unobserve(stage));
    });
    inject(DestroyRef).onDestroy(() => {
      observer.disconnect();
      if ("svg" in image) URL.revokeObjectURL(this.url);
    });
  }

  protected loaded(event: Event) {
    const image = event.target as HTMLImageElement;
    // SVG without a size of its own reports none; it then starts at the size the page showed it at.
    const natural = image.naturalWidth && image.naturalHeight ? { width: image.naturalWidth, height: image.naturalHeight } : null;
    this.natural.set(natural ?? this.picture.shown);
    this.measure();
  }

  /** Takes the stage's size: a fitted picture fits it again, an adjusted one keeps its centre where it was. */
  private measure() {
    const stage = this.stage()?.nativeElement;
    const natural = this.natural();
    if (!stage || !stage.clientWidth || !stage.clientHeight) return;
    const size = { width: stage.clientWidth, height: stage.clientHeight };
    const before = this.stageSize();
    this.stageSize.set(size);
    if (!natural) return;
    if (!this.adjusted || !before) return this.fit(false);
    const { x, y, scale } = this.view();
    this.view.set(keptInView({ scale, x: x + (size.width - before.width) / 2, y: y + (size.height - before.height) / 2 }, natural, size));
  }

  protected fit(animated: boolean) {
    const natural = this.natural();
    const stage = this.stageSize();
    if (!natural || !stage) return;
    this.adjusted = false;
    this.animated.set(animated);
    this.view.set(centred(natural, stage, fitScale(natural, stage)));
  }

  protected actualSize(point: Point | null, animated: boolean) {
    this.zoomTo(1, point, animated);
  }

  /** One step in (1) or out (-1), around the pointer when it is on the stage. */
  protected step(direction: 1 | -1, point: Point | null = null) {
    this.zoomTo(this.view().scale * STEP ** direction, point, true);
  }

  /** Zooms to `scale` (within the limits) around `point`, or around the stage's centre. */
  private zoomTo(scale: number, point: Point | null, animated: boolean) {
    const natural = this.natural();
    const stage = this.stageSize();
    if (!natural || !stage) return;
    const bounded = Math.min(Math.max(scale, this.minimum()), this.maximum());
    const around = point ?? { x: stage.width / 2, y: stage.height / 2 };
    this.adjusted = true;
    this.animated.set(animated);
    this.view.set(keptInView(zoomedAround(this.view(), bounded, around), natural, stage));
  }

  private moveBy(x: number, y: number, animated: boolean) {
    const natural = this.natural();
    const stage = this.stageSize();
    if (!natural || !stage) return;
    const view = this.view();
    this.adjusted = true;
    this.animated.set(animated);
    this.view.set(keptInView({ ...view, x: view.x + x, y: view.y + y }, natural, stage));
  }

  private pointIn(event: MouseEvent): Point {
    const bounds = this.stage()!.nativeElement.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  protected wheel(event: WheelEvent) {
    event.preventDefault();
    const lines = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? 400 : 1;
    // A pinch on a touchpad arrives as the wheel with Ctrl, in small steps.
    const speed = event.ctrlKey ? 0.01 : 0.002;
    this.zoomTo(this.view().scale * Math.exp(-event.deltaY * lines * speed), this.pointIn(event), false);
  }

  protected pointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    this.pointers.set(event.pointerId, this.pointIn(event));
    this.dragging.set(true);
  }

  /** One pointer drags the picture; two pinch it, zooming around the point between them. */
  protected pointerMove(event: PointerEvent) {
    const point = this.pointIn(event);
    this.pointer = point;
    const last = this.pointers.get(event.pointerId);
    if (!last) return;
    this.pointers.set(event.pointerId, point);
    const other = [...this.pointers].find(([id]) => id !== event.pointerId)?.[1];
    if (!other) return this.moveBy(point.x - last.x, point.y - last.y, false);
    const before = midpoint(last, other);
    const after = midpoint(point, other);
    this.moveBy(after.x - before.x, after.y - before.y, false);
    const spread = distance(last, other);
    if (spread > 0) this.zoomTo((this.view().scale * distance(point, other)) / spread, after, false);
  }

  protected pointerUp(event: PointerEvent) {
    this.pointers.delete(event.pointerId);
    this.dragging.set(this.pointers.size > 0);
  }

  protected key(event: KeyboardEvent) {
    // An Escape the source's editor used, to close its search, stays there instead of closing the popup.
    if (event.key === "Escape") return event.defaultPrevented ? event.stopPropagation() : undefined;
    if (!this.showsPicture() || isTyping(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    const onStage = event.target === this.stage()?.nativeElement;
    switch (event.key) {
      case "+":
      case "=":
        this.step(1, this.pointer);
        break;
      case "-":
      case "_":
        this.step(-1, this.pointer);
        break;
      case "0":
        this.fit(true);
        break;
      case "1":
        this.actualSize(this.pointer, true);
        break;
      default: {
        const nudge = onStage && ARROWS[event.key];
        if (!nudge) return;
        this.moveBy(nudge.x * NUDGE, nudge.y * NUDGE, true);
      }
    }
    event.preventDefault();
  }
}

/** The arrow keys look further that way, as scrolling does: the picture moves the other way. */
const ARROWS: Readonly<Record<string, Point>> = {
  ArrowLeft: { x: 1, y: 0 },
  ArrowRight: { x: -1, y: 0 },
  ArrowUp: { x: 0, y: 1 },
  ArrowDown: { x: 0, y: -1 },
};
