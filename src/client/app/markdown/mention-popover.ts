/** Who an `@mention` means, next to it: name, handle and email, and their tasks. */
import { Overlay, type OverlayRef } from "@angular/cdk/overlay";
import { ComponentPortal } from "@angular/cdk/portal";
import { afterNextRender, ChangeDetectionStrategy, Component, ElementRef, inject, InjectionToken, Injector } from "@angular/core";
import { Router } from "@angular/router";
import type { Person } from "../../../contracts/model";
import { Clipboard } from "../core/clipboard";
import { Avatar } from "../ui/avatar";
import { Icon } from "../ui/icon";

interface PopoverData {
  readonly person: Person;
  readonly close: () => void;
}

const POPOVER_DATA = new InjectionToken<PopoverData>("MentionPopover");

@Component({
  selector: "gd-mention-popover",
  imports: [Avatar, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "mention-popover", role: "dialog", "[attr.aria-label]": "person.name", "(keydown)": "key($event)" },
  template: `
    <header class="mention-popover-header">
      <gd-avatar [name]="person.name" [size]="32" />
      <div class="mention-popover-who">
        <strong class="ellipsis">{{ person.name }}</strong>
        <span class="mono faint">&#64;{{ person.handle }}</span>
      </div>
    </header>
    @if (person.email; as email) {
      <div class="mention-popover-email">
        <span class="ellipsis selectable">{{ email }}</span>
        <button type="button" class="icon-btn" aria-label="Copy email" title="Copy email" (click)="copyEmail(email)">
          <svg gd-icon name="copy" [size]="13"></svg>
        </button>
      </div>
    }
    <div class="menu-separator"></div>
    <button type="button" class="menu-item" (click)="showTasks()">
      <span class="menu-icon"><svg gd-icon name="square-check" [size]="14"></svg></span>Tasks assigned to {{ firstName }}
    </button>
  `,
})
export class MentionPopover {
  private readonly data = inject(POPOVER_DATA);
  private readonly router = inject(Router);
  private readonly clipboard = inject(Clipboard);
  protected readonly person = this.data.person;

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    afterNextRender(() => host.querySelector<HTMLElement>("button")?.focus());
  }

  protected readonly firstName = this.person.name.split(/\s+/)[0] || this.person.handle;

  protected copyEmail(email: string) {
    void this.clipboard.copy(email, "Email");
  }

  protected showTasks() {
    this.data.close();
    void this.router.navigate(["/tasks"], { queryParams: { assignee: this.person.handle } });
  }

  protected key(event: KeyboardEvent) {
    if (event.key !== "Escape" && event.key !== "Tab") return;
    // Tab leaves the popover, as from a menu; focus returns to the mention.
    event.preventDefault();
    event.stopPropagation();
    this.data.close();
  }
}

/** Shows `person` below the mention `anchor` until a click elsewhere, Escape or Tab; focus returns to the mention. */
export function openMentionPopover(injector: Injector, anchor: HTMLElement, person: Person): OverlayRef {
  const overlay = injector.get(Overlay);
  const reference = overlay.create({
    positionStrategy: overlay
      .position()
      .flexibleConnectedTo(anchor)
      .withPositions([
        { originX: "start", originY: "bottom", overlayX: "start", overlayY: "top", offsetY: 4 },
        { originX: "start", originY: "top", overlayX: "start", overlayY: "bottom", offsetY: -4 },
      ])
      .withViewportMargin(8),
    scrollStrategy: overlay.scrollStrategies.close(),
    hasBackdrop: true,
    backdropClass: "cdk-overlay-transparent-backdrop",
  });
  const close = () => {
    if (!reference.hasAttached()) return;
    reference.dispose();
    anchor.focus();
  };
  reference.backdropClick().subscribe(close);
  const data: PopoverData = { person, close };
  reference.attach(
    new ComponentPortal(
      MentionPopover,
      null,
      Injector.create({ providers: [{ provide: POPOVER_DATA, useValue: data }], parent: injector }),
    ),
  );
  return reference;
}
