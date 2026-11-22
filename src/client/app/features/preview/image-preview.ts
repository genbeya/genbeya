import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import type { PixelSize } from "./file-size";

/** One image at its own size, at most as wide as the space it has, over a checkerboard that shows its transparency. */
@Component({
  selector: "gd-image-preview",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "image-preview" },
  template: `<img [src]="src()" [alt]="alt()" (load)="loaded($event)" />`,
  styles: `
    :host {
      display: flex;
      justify-content: center;
      min-width: 0;
    }
    img {
      max-width: 100%;
      height: auto;
      background: repeating-conic-gradient(var(--bg-hover) 0 25%, transparent 0 50%) 0 0 / 16px 16px;
    }
  `,
})
export class ImagePreview {
  readonly src = input.required<string>();
  readonly alt = input.required<string>();
  /** The image's size in pixels, once it loaded. */
  readonly measured = output<PixelSize>();

  protected loaded(event: Event) {
    const image = event.target as HTMLImageElement;
    this.measured.emit({ width: image.naturalWidth, height: image.naturalHeight });
  }
}
