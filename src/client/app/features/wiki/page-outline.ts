import { ChangeDetectionStrategy, Component, effect, input, signal, untracked } from "@angular/core";

interface Heading {
  readonly id: string;
  readonly text: string;
  readonly level: 2 | 3;
}

/** Headings closer than this to the top of the scroll area count as read. */
const READ_OFFSET = 80;
/** Short pages need no outline. */
const MINIMUM_HEADINGS = 3;

/** "On this page": the h2 and h3 headings of rendered content, marking the one being read. */
@Component({
  selector: "gd-page-outline",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "wiki-outline" },
  template: `
    @if (headings().length >= minimum) {
      <nav class="wiki-outline-inner" aria-label="On this page">
        <div class="outline-title">On this page</div>
        @for (heading of headings(); track heading.id) {
          <button
            type="button"
            class="outline-item level-{{ heading.level }}"
            [class.is-current]="current() === heading.id"
            (click)="scrollTo(heading.id)"
          >
            {{ heading.text }}
          </button>
        }
      </nav>
    }
  `,
})
export class PageOutline {
  /** The latest render of the content; a new object per render. */
  readonly content = input.required<{ readonly element: HTMLElement } | null>();
  /** The element that scrolls the content. */
  readonly scroller = input.required<HTMLElement>();
  protected readonly headings = signal<readonly Heading[]>([]);
  protected readonly current = signal<string | null>(null);
  protected readonly minimum = MINIMUM_HEADINGS;

  constructor() {
    effect(() => {
      const content = this.content()?.element;
      this.headings.set(
        content
          ? [...content.querySelectorAll<HTMLElement>("h2[id], h3[id]")].map((heading) => ({
              id: heading.id,
              text: heading.textContent ?? "",
              level: heading.tagName === "H2" ? 2 : 3,
            }))
          : [],
      );
      untracked(() => this.track());
    });
    const scroll = () => this.track();
    effect((cleanup) => {
      const scroller = this.scroller();
      scroller.addEventListener("scroll", scroll, { passive: true });
      cleanup(() => scroller.removeEventListener("scroll", scroll));
    });
  }

  private track() {
    const top = this.scroller().getBoundingClientRect().top;
    let active = this.headings()[0]?.id ?? null;
    for (const heading of this.headings()) {
      const element = this.content()?.element.querySelector(`#${CSS.escape(heading.id)}`);
      if (element && element.getBoundingClientRect().top - top < READ_OFFSET) active = heading.id;
    }
    this.current.set(active);
  }

  protected scrollTo(id: string) {
    this.content()
      ?.element.querySelector(`#${CSS.escape(id)}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}
