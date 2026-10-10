import { DIALOG_DATA, DialogRef } from "@angular/cdk/dialog";
import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { ExternalLinks } from "../../core/external-links";
import type { LinkTarget } from "../../markdown/link-target";
import { MarkdownView } from "../../markdown/markdown-view";
import { DialogFrame } from "../../ui/dialog-frame";
import type { WhatsNew } from "./onboarding";

/** The news of one or more releases; closes with "tour" when the user wants to be shown around them. */
@Component({
  selector: "gd-whats-new-dialog",
  imports: [DialogFrame, MarkdownView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <gd-dialog-frame [title]="title" [width]="500">
      @for (release of data.releases; track release.version) {
        @if (data.releases.length > 1) {
          <h3 class="news-version">GitDesk {{ release.version }}</h3>
        }
        <ul class="news-list">
          @for (item of release.items; track item.title) {
            <li>
              <strong>{{ item.title }}</strong>
              <gd-markdown class="news-body" [source]="item.body" path="" (linkClicked)="follow($event)" />
            </li>
          }
        </ul>
      }
      <footer>
        @if (data.tour) {
          <button type="button" class="btn btn-default btn-m" (click)="dialog.close('tour')"><span>Show me</span></button>
        }
        <button type="button" class="btn btn-primary btn-m" (click)="dialog.close()"><span>Got it</span></button>
      </footer>
    </gd-dialog-frame>
  `,
  styles: `
    .news-version {
      margin: 4px 0 -6px;
      color: var(--text-3);
      font-size: 11.5px;
      font-weight: 600;
    }
    .news-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .news-body {
      margin-top: 2px;
      color: var(--text-2);
      font-size: 13px;
      line-height: 1.55;
    }
  `,
})
export class WhatsNewDialog {
  protected readonly dialog = inject<DialogRef<"tour">>(DialogRef);
  protected readonly data = inject<WhatsNew>(DIALOG_DATA);
  protected readonly title = `What's new in GitDesk ${this.data.releases[0]!.version}`;
  private readonly links = inject(ExternalLinks);

  protected follow(target: LinkTarget) {
    if (target.kind === "external") void this.links.open(target.url);
  }
}
