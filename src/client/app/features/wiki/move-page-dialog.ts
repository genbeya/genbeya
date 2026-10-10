import { DIALOG_DATA, DialogRef } from "@angular/cdk/dialog";
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  type ElementRef,
  inject,
  signal,
  viewChild,
} from "@angular/core";
import type { LinkUpdate } from "../../../../contracts/model";
import { Session } from "../../core/session";
import { debounced } from "../../core/signals";
import { WorkspaceApi } from "../../core/workspace-api";
import { DialogFrame } from "../../ui/dialog-frame";
import { selectName } from "../../ui/prompt-dialog";
import { pageName, pageNameProblem, pagePath } from "./wiki-pages";

export interface MovePageOptions {
  readonly path: string;
}

export interface PageMoveChoice {
  readonly to: string;
  readonly updateLinks: boolean;
}

/** How long typing pauses before the links to update are looked up. */
const LOOKUP_DELAY = 200;

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/**
 * Asks for a page's new name. When links point at the page or out of it, it
 * offers to update them in the same commit, and lists them.
 */
@Component({
  selector: "gd-move-page-dialog",
  imports: [DialogFrame],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: "./move-page-dialog.css",
  template: `
    <gd-dialog-frame title="Move page" [width]="480" (submitted)="submit()">
      <label class="field">
        New name
        <input #field class="input" spellcheck="false" [value]="name()" (input)="edit(field.value)" />
      </label>
      @if (error(); as message) {
        <p class="dialog-error" role="alert">{{ message }}</p>
      } @else {
        <p class="dialog-hint">Use / to nest pages. Subpages move along.</p>
      }
      @if (links().length) {
        <div class="move-links">
          <label class="checkbox">
            <input type="checkbox" [checked]="updateLinks()" (change)="updateLinks.set($any($event.target).checked)" />
            Update {{ linkCount() }} in {{ fileCount() }}
          </label>
          <details>
            <summary>Show links</summary>
            <ul>
              @for (file of links(); track file.path) {
                <li>
                  <span class="mono">{{ file.path }}</span>
                  <ul>
                    @for (change of file.changes; track $index) {
                      <li>
                        <span class="move-line">{{ change.line }}</span>
                        <code>{{ change.before }}</code> → <code>{{ change.after }}</code>
                      </li>
                    }
                  </ul>
                </li>
              }
            </ul>
          </details>
        </div>
      }
      <footer>
        <button type="button" class="btn btn-default btn-m" (click)="dialog.close()"><span>Cancel</span></button>
        <button type="submit" class="btn btn-primary btn-m" [disabled]="!name().trim()"><span>Move</span></button>
      </footer>
    </gd-dialog-frame>
  `,
})
export class MovePageDialog {
  private readonly options = inject<MovePageOptions>(DIALOG_DATA);
  protected readonly dialog = inject<DialogRef<PageMoveChoice>>(DialogRef);
  private readonly api = inject(WorkspaceApi);
  private readonly root = inject(Session).snapshot()?.settings.wikiRoot ?? "docs";
  protected readonly name = signal(pageName(this.options.path, this.root));
  protected readonly error = signal<string | null>(null);
  protected readonly updateLinks = signal(true);
  /** The links of the last name looked up; stale ones are dropped. */
  protected readonly links = signal<readonly LinkUpdate[]>([]);
  protected readonly linkCount = computed(() =>
    count(
      this.links().reduce((sum, file) => sum + file.changes.length, 0),
      "link",
    ),
  );
  protected readonly fileCount = computed(() => count(this.links().length, "page"));
  /** Where the page would move; null while the name is unusable. */
  private readonly target = computed(() => {
    const name = this.name().trim();
    return name && !pageNameProblem(name) ? pagePath(this.root, name) : null;
  });
  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>("field");

  constructor() {
    afterNextRender(() => selectName(this.field().nativeElement));
    const target = debounced(this.target, LOOKUP_DELAY);
    let request = 0;
    effect(() => {
      const to = target();
      const ticket = ++request;
      const show = (links: readonly LinkUpdate[]) => {
        if (ticket === request) this.links.set(links);
      };
      // The move checks the links again; a failed lookup only shows none.
      if (to && to !== this.options.path) this.api.content.pageLinks(this.options.path, to).then(show, () => show([]));
      else show([]);
    });
  }

  protected edit(value: string) {
    this.name.set(value);
    this.error.set(null);
  }

  protected submit() {
    const name = this.name().trim();
    if (!name) return;
    const problem = pageNameProblem(name);
    if (problem) this.error.set(problem);
    else this.dialog.close({ to: pagePath(this.root, name), updateLinks: this.updateLinks() });
  }
}
