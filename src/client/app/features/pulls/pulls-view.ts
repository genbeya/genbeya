import { ChangeDetectionStrategy, Component, computed, inject, input, signal, ViewEncapsulation } from "@angular/core";
import { Router } from "@angular/router";
import type { PullRequest } from "../../../../contracts/model";
import { openItems, parsePullBody } from "../../../../utilities/pull-requests";
import { Session } from "../../core/session";
import { EmptyState } from "../../ui/empty-state";
import { Icon } from "../../ui/icon";
import { Remembered } from "../../ui/remembered";
import { Resizable, ResizeHandle } from "../../ui/resizable";
import { PullActions } from "./pull-actions";
import { PullPage, type PullTab } from "./pull-page";
import { STATUS_ICONS, STATUS_LABELS } from "./pull-status";

type Shown = "open" | "merged" | "closed" | "all";
const SHOWN_KEY = "pulls:shown";
const SHOWN: readonly { readonly value: Shown; readonly label: string }[] = [
  { value: "open", label: "Open" },
  { value: "merged", label: "Merged" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];

/** Whether `pull` is among those shown: open ones include drafts. */
const isShown = (pull: PullRequest, shown: Shown) =>
  shown === "all" || pull.status === shown || (shown === "open" && pull.status === "draft");

/**
 * The pull requests of the repository and the selected one (`?pull=&tab=&file=`).
 * Styles are global but namespaced, so the feature's sub-components share them.
 */
@Component({
  selector: "gd-pulls-view",
  imports: [EmptyState, Icon, PullPage, Resizable, ResizeHandle],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrl: "./pulls.css",
  host: { class: "view pulls-view" },
  template: `
    <div class="view-body">
      <aside class="side-panel pull-list-panel" gdResizable="pulls" [initial]="340" [min]="260" [max]="600" #panel="gdResizable">
        <div class="panel-toolbar pull-list-toolbar">
          <div class="segmented" role="radiogroup" aria-label="Show">
            @for (option of shownOptions; track option.value) {
              <button
                type="button"
                role="radio"
                [attr.aria-checked]="shown() === option.value"
                [class.is-active]="shown() === option.value"
                (click)="show(option.value)"
              >
                {{ option.label }}
              </button>
            }
          </div>
          <span class="grow"></span>
          <button type="button" class="icon-btn" aria-label="New pull request" title="New pull request" (click)="actions.create()">
            <svg gd-icon name="plus" [size]="15"></svg>
          </button>
        </div>
        <label class="filter pull-filter">
          <svg gd-icon name="search" [size]="13"></svg>
          <input #search placeholder="Filter" aria-label="Filter pull requests" [value]="query()" (input)="query.set(search.value)" />
        </label>
        <div class="side-panel-scroll" role="list" aria-label="Pull requests">
          @for (item of rows(); track item.pull.id) {
            <button
              type="button"
              role="listitem"
              class="pull-row"
              [class.is-selected]="item.pull.id === selected()?.id"
              [attr.aria-current]="item.pull.id === selected()?.id || null"
              (click)="select(item.pull.id)"
            >
              <svg
                gd-icon
                class="pull-row-icon is-{{ item.pull.status }}"
                [name]="icons[item.pull.status]"
                [size]="15"
                [attr.aria-label]="labels[item.pull.status]"
              ></svg>
              <span class="pull-row-text">
                <span class="pull-row-title ellipsis">{{ item.pull.title || item.pull.id }}</span>
                <span class="pull-row-meta ellipsis"
                  >{{ item.pull.id }} · {{ item.pull.source }} → {{ item.pull.target
                  }}{{ item.pull.author ? " · " + item.pull.author : "" }}</span
                >
              </span>
              @if (item.todos) {
                <span class="pull-row-todos" [attr.aria-label]="item.todos + ' open to-dos'" title="Open to-dos">{{ item.todos }}</span>
              }
            </button>
          } @empty {
            <p class="faint pull-list-empty">{{ pulls().length ? "No pull request matches." : "No pull requests yet." }}</p>
          }
        </div>
      </aside>
      <div [gdResizeHandle]="panel"></div>
      <section class="main-pane">
        @if (selected(); as pull) {
          @for (key of [pull.id]; track key) {
            <gd-pull-page [pull]="pull" [tab]="tab() === 'files' ? 'files' : 'conversation'" [file]="file()" />
          }
        } @else if (pull()) {
          <gd-empty-state title="No such pull request"
            ><p>{{ pull() }} is not in {{ folder() }}/.</p></gd-empty-state
          >
        } @else {
          <gd-empty-state title="Pull requests">
            <svg icon gd-icon name="git-pull-request" [size]="20"></svg>
            <p>
              A pull request is a Markdown file in {{ folder() }}/: the branches, the description, the review and the discussion. Open one
              to ask for a review of a branch.
            </p>
            <button type="button" class="btn btn-primary btn-m" (click)="actions.create()"><span>New pull request</span></button>
          </gd-empty-state>
        }
      </section>
    </div>
  `,
})
export class PullsView {
  readonly pull = input<string>();
  readonly tab = input<PullTab | string>();
  readonly file = input<string>();

  protected readonly actions = inject(PullActions);
  private readonly session = inject(Session);
  private readonly router = inject(Router);
  private readonly memory = inject(Remembered);
  protected readonly icons = STATUS_ICONS;
  protected readonly labels = STATUS_LABELS;
  protected readonly shownOptions = SHOWN;
  protected readonly shown = signal<Shown>((this.memory.recall(SHOWN_KEY) as Shown | null) ?? "open");
  protected readonly query = signal("");
  protected readonly pulls = computed(() => this.session.snapshot()?.pulls ?? []);
  protected readonly folder = computed(() => this.session.snapshot()?.settings.pullRoot ?? "pulls");
  protected readonly selected = computed(() => this.pulls().find((pull) => pull.id === this.pull()) ?? null);
  /** Newest first, with their open to-dos. */
  protected readonly rows = computed(() => {
    const query = this.query().trim().toLowerCase();
    const number = (pull: PullRequest) => Number(/(\d+)$/.exec(pull.id)?.[1] ?? 0);
    return this.pulls()
      .filter((pull) => isShown(pull, this.shown()) || pull.id === this.pull())
      .filter(
        (pull) =>
          !query || [pull.id, pull.title, pull.source, pull.target, pull.author, ...pull.reviewers].join(" ").toLowerCase().includes(query),
      )
      .sort((a, b) => number(b) - number(a))
      .map((pull) => ({
        pull,
        todos: pull.status === "open" || pull.status === "draft" ? openItems(parsePullBody(pull.body)).todos.length : 0,
      }));
  });

  protected show(shown: Shown) {
    this.shown.set(shown);
    this.memory.remember(SHOWN_KEY, shown);
  }

  protected select(id: string) {
    void this.router.navigate(["/pulls"], { queryParams: { pull: id } });
  }
}
