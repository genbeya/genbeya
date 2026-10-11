import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { Icon } from "../../ui/icon";
import { Onboarding } from "./onboarding";

/** Offers the tour in the sidebar of a repository opened for the first time; it waits there without getting in the way. */
@Component({
  selector: "gd-tour-offer",
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div aria-live="polite">
      @if (onboarding.offer()) {
        <section class="tour-offer" aria-labelledby="tour-offer-title">
          <h2 id="tour-offer-title"><svg gd-icon name="compass" [size]="14"></svg>New to GitDesk?</h2>
          <p>A short tour shows where everything is.</p>
          <div class="row">
            <button type="button" class="btn btn-primary btn-s" (click)="onboarding.startTour()"><span>Show me around</span></button>
            <button type="button" class="btn btn-ghost btn-s" (click)="onboarding.dismissOffer()"><span>Not now</span></button>
          </div>
        </section>
      }
    </div>
  `,
  styles: `
    .tour-offer {
      margin: 8px 0;
      padding: 10px 12px 12px;
      border: 1px solid var(--line);
      border-radius: var(--radius-l);
      background: var(--accent-soft);
      animation: fade-in 160ms ease-out;
    }
    h2 {
      display: flex;
      align-items: center;
      gap: 7px;
      margin: 0;
      font-size: 13px;
      font-weight: 600;
    }
    h2 svg {
      color: var(--accent-text);
    }
    p {
      margin: 4px 0 10px;
      color: var(--text-2);
      font-size: 12.5px;
      line-height: 1.45;
    }
    .row {
      gap: 6px;
    }
    @media (prefers-reduced-motion: reduce) {
      .tour-offer {
        animation: none;
      }
    }
  `,
})
export class TourOffer {
  protected readonly onboarding = inject(Onboarding);
}
