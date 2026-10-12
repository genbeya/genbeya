import { computed, Directive, effect, ElementRef, inject, input, signal } from "@angular/core";
import { Remembered } from "./remembered";

/** The edge the user drags: the right one sets the width, the top one the height. */
export type ResizeEdge = "right" | "top";

const STORAGE_PREFIX: Readonly<Record<ResizeEdge, string>> = { right: "width:", top: "height:" };

/**
 * A panel the user can resize by dragging its right edge (or, for a bottom
 * panel, its top edge); the size is remembered per key. Put
 * `<div gdResizeHandle [for]="panel">` inside it.
 */
@Directive({
  selector: "[gdResizable]",
  exportAs: "gdResizable",
  host: {
    "[style.width.px]": "edge() === 'right' ? size() : null",
    "[style.height.px]": "edge() === 'top' ? size() : null",
    "[style.flex]": "'none'",
    "[style.position]": "'relative'",
  },
})
export class Resizable {
  readonly key = input.required<string>({ alias: "gdResizable" });
  readonly edge = input<ResizeEdge>("right");
  readonly initial = input(260);
  readonly min = input(180);
  readonly max = input(560);
  readonly size = signal(260);
  readonly dragging = signal(false);
  private readonly element: HTMLElement = inject(ElementRef).nativeElement;
  private readonly memory = inject(Remembered);
  private readonly storageKey = computed(() => STORAGE_PREFIX[this.edge()] + this.key());

  constructor() {
    effect(() => {
      const stored = Number(this.memory.recall(this.storageKey()));
      this.size.set(stored > 0 ? stored : this.initial());
    });
  }

  start(event: PointerEvent): void {
    event.preventDefault();
    // Dragging right widens; dragging the top edge up makes the panel taller.
    const position = (pointer: PointerEvent) => (this.edge() === "top" ? -pointer.clientY : pointer.clientX);
    const origin = position(event);
    // The layout may keep the panel smaller than its size (a CSS maximum, a small window). Dragging starts from
    // what shows and stops where the panel stops growing, so the edge follows the pointer without a dead zone.
    const from = Math.min(this.size(), this.rendered(this.size()) || this.size());
    const max = Math.min(this.max(), this.rendered(this.max()) || this.max());
    const clamp = (pointer: PointerEvent) => Math.min(max, Math.max(this.min(), from + position(pointer) - origin));
    this.dragging.set(true);
    const move = (moved: PointerEvent) => this.size.set(clamp(moved));
    const end = (ended: PointerEvent) => {
      this.dragging.set(false);
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", end);
      this.memory.remember(this.storageKey(), String(clamp(ended)));
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", end);
  }

  reset(): void {
    this.size.set(this.initial());
  }

  /** How large the panel shows at `size`; 0 while it is hidden. */
  private rendered(size: number): number {
    const top = this.edge() === "top";
    const style = this.element.style;
    const property = top ? "height" : "width";
    const previous = style[property];
    style[property] = `${size}px`;
    const shown = top ? this.element.offsetHeight : this.element.offsetWidth;
    style[property] = previous;
    return shown;
  }
}

@Directive({
  selector: "[gdResizeHandle]",
  host: {
    class: "resizer",
    role: "separator",
    "[attr.aria-orientation]": "panel().edge() === 'top' ? 'horizontal' : 'vertical'",
    "[class.is-dragging]": "panel().dragging()",
    "(pointerdown)": "panel().start($event)",
    "(dblclick)": "panel().reset()",
  },
})
export class ResizeHandle {
  readonly panel = input.required<Resizable>({ alias: "gdResizeHandle" });
}
