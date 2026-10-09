import { Directive, effect, input, signal } from "@angular/core";

const STORAGE_PREFIX = "width:";

function stored(key: string, fallback: number): number {
  try {
    const value = Number(localStorage.getItem(STORAGE_PREFIX + key));
    return value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

/**
 * A panel the user can widen by dragging its right edge; the width is
 * remembered per key. Put `<div gdResizeHandle [for]="panel">` inside it.
 */
@Directive({
  selector: "[gdResizable]",
  exportAs: "gdResizable",
  host: { "[style.width.px]": "width()", "[style.flex]": "'none'", "[style.position]": "'relative'" },
})
export class Resizable {
  readonly key = input.required<string>({ alias: "gdResizable" });
  readonly initial = input(260);
  readonly min = input(180);
  readonly max = input(560);
  readonly width = signal(260);
  readonly dragging = signal(false);

  constructor() {
    effect(() => this.width.set(stored(this.key(), this.initial())));
  }

  start(event: PointerEvent): void {
    event.preventDefault();
    const origin = event.clientX;
    const from = this.width();
    const clamp = (x: number) => Math.min(this.max(), Math.max(this.min(), from + x - origin));
    this.dragging.set(true);
    const move = (moved: PointerEvent) => this.width.set(clamp(moved.clientX));
    const end = (ended: PointerEvent) => {
      this.dragging.set(false);
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", end);
      try {
        localStorage.setItem(STORAGE_PREFIX + this.key(), String(clamp(ended.clientX)));
      } catch {
        // A remembered width is a convenience.
      }
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", end);
  }

  reset(): void {
    this.width.set(this.initial());
  }
}

@Directive({
  selector: "[gdResizeHandle]",
  host: {
    class: "resizer",
    role: "separator",
    "aria-orientation": "vertical",
    "[class.is-dragging]": "panel().dragging()",
    "(pointerdown)": "panel().start($event)",
    "(dblclick)": "panel().reset()",
  },
})
export class ResizeHandle {
  readonly panel = input.required<Resizable>({ alias: "gdResizeHandle" });
}
