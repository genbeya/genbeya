import { CdkMenu, CdkMenuTrigger } from "@angular/cdk/menu";
import { ChangeDetectionStrategy, Component, computed, inject, input, output } from "@angular/core";
import { LucideFolder, LucidePlus, LucideTag, LucideUser } from "@lucide/angular";
import { PRIORITIES, type TaskInput } from "../../../../contracts/model";
import { Dialogs } from "../../core/dialogs";
import { Session } from "../../core/session";
import { Avatar } from "../../ui/avatar";
import { MenuItem } from "../../ui/menu-item";
import { LabelChip, PriorityIcon, StatusIcon } from "./task-icons";
import { epicName, epicsOf, labelsOf, peopleOf, titleCase } from "./task-model";

/** Status, priority, assignee, labels and epic as compact menu buttons. */
@Component({
  selector: "gd-task-properties",
  imports: [
    CdkMenu,
    CdkMenuTrigger,
    MenuItem,
    Avatar,
    LabelChip,
    PriorityIcon,
    StatusIcon,
    LucideFolder,
    LucidePlus,
    LucideTag,
    LucideUser,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "task-properties" },
  template: `
    <button type="button" class="property" aria-label="Status" [cdkMenuTriggerFor]="statusMenu">
      <gd-status-icon [status]="value().status" [statuses]="statuses()" />{{ titleCase(value().status) }}
    </button>
    <button type="button" class="property" aria-label="Priority" [cdkMenuTriggerFor]="priorityMenu">
      <gd-priority-icon [priority]="value().priority" />{{ priorityName(value().priority) }}
    </button>
    <button type="button" class="property" aria-label="Assignee" [cdkMenuTriggerFor]="assigneeMenu">
      @if (value().assignee) {
        <gd-avatar [name]="value().assignee" [size]="16" />{{ value().assignee }}
      } @else {
        <svg lucideUser [size]="14" aria-hidden="true"></svg>Unassigned
      }
    </button>
    <button type="button" class="property" aria-label="Epic" [cdkMenuTriggerFor]="epicMenu">
      <svg lucideFolder [size]="13" aria-hidden="true"></svg>{{ epicName(value().epic) }}
    </button>
    <button type="button" class="property" aria-label="Labels" [cdkMenuTriggerFor]="labelMenu">
      @for (label of value().labels; track label) {
        <gd-label-chip [name]="label" />
      } @empty {
        <svg lucideTag [size]="13" aria-hidden="true"></svg>Labels
      }
    </button>

    <ng-template #statusMenu>
      <div class="menu" cdkMenu>
        @for (status of statuses(); track status) {
          <button gd-menu-item [checked]="status === value().status" (selected)="changed.emit({ status })">
            <gd-status-icon icon [status]="status" [statuses]="statuses()" />{{ titleCase(status) }}
          </button>
        }
      </div>
    </ng-template>
    <ng-template #priorityMenu>
      <div class="menu" cdkMenu>
        @for (priority of priorities; track priority) {
          <button gd-menu-item [checked]="priority === value().priority" (selected)="changed.emit({ priority })">
            <gd-priority-icon icon [priority]="priority" />{{ priorityName(priority) }}
          </button>
        }
      </div>
    </ng-template>
    <ng-template #assigneeMenu>
      <div class="menu" cdkMenu>
        <button gd-menu-item [checked]="!value().assignee" (selected)="changed.emit({ assignee: '' })">
          <svg icon lucideUser [size]="14" aria-hidden="true"></svg>Unassigned
        </button>
        @for (person of people(); track person) {
          <button gd-menu-item [checked]="person === value().assignee" (selected)="changed.emit({ assignee: person })">
            <gd-avatar icon [name]="person" [size]="16" />{{ person }}
          </button>
        }
        <div class="menu-separator"></div>
        <button gd-menu-item (selected)="assignSomeoneElse()">
          <svg icon lucidePlus [size]="14" aria-hidden="true"></svg>Someone else…
        </button>
      </div>
    </ng-template>
    <ng-template #epicMenu>
      <div class="menu" cdkMenu>
        <button gd-menu-item [checked]="!value().epic" (selected)="changed.emit({ epic: '' })">
          <svg icon lucideFolder [size]="13" aria-hidden="true"></svg>No epic
        </button>
        @for (epic of epics(); track epic) {
          <button gd-menu-item [checked]="epic === value().epic" (selected)="changed.emit({ epic })">
            <svg icon lucideFolder [size]="13" aria-hidden="true"></svg>{{ epic }}
          </button>
        }
        <div class="menu-separator"></div>
        <button gd-menu-item (selected)="newEpic()"><svg icon lucidePlus [size]="14" aria-hidden="true"></svg>New epic…</button>
      </div>
    </ng-template>
    <ng-template #labelMenu>
      <div class="menu" cdkMenu>
        @for (label of labels(); track label) {
          <button gd-menu-item [checked]="value().labels.includes(label)" (selected)="toggleLabel(label)">
            <svg icon lucideTag [size]="13" aria-hidden="true"></svg>{{ label }}
          </button>
        }
        @if (labels().length) {
          <div class="menu-separator"></div>
        }
        <button gd-menu-item (selected)="addLabel()"><svg icon lucidePlus [size]="14" aria-hidden="true"></svg>New label…</button>
      </div>
    </ng-template>
  `,
})
export class TaskProperties {
  readonly value = input.required<TaskInput>();
  readonly changed = output<Partial<TaskInput>>();
  private readonly session = inject(Session);
  private readonly dialogs = inject(Dialogs);
  protected readonly priorities = PRIORITIES;
  protected readonly titleCase = titleCase;
  protected readonly statuses = computed(() => this.session.snapshot()!.settings.statuses);
  protected readonly people = computed(() => peopleOf(this.session.snapshot()!.tasks));
  protected readonly epicName = epicName;
  /** Epics of other tasks, and this one's even while it is the only task in it. */
  protected readonly epics = computed(() =>
    [...new Set([...epicsOf(this.session.snapshot()!.tasks), ...(this.value().epic ? [this.value().epic] : [])])].sort(),
  );
  protected readonly labels = computed(() => [...new Set([...labelsOf(this.session.snapshot()!.tasks), ...this.value().labels])].sort());

  protected priorityName(priority: string): string {
    return priority === "none" ? "No priority" : titleCase(priority);
  }

  protected toggleLabel(label: string) {
    const labels = this.value().labels;
    this.changed.emit({ labels: labels.includes(label) ? labels.filter((other) => other !== label) : [...labels, label] });
  }

  protected async assignSomeoneElse() {
    const name = await this.dialogs.prompt({ title: "Assign", label: "Name", placeholder: "alice", confirm: "Assign" });
    if (name) this.changed.emit({ assignee: name });
  }

  /** Epics are folders below the task folder; "/" nests them. */
  protected async newEpic() {
    const epic = await this.dialogs.prompt({
      title: "New epic",
      label: "Epic name",
      placeholder: "Login rework",
      confirm: "Move here",
      hint: "The task moves into a folder of this name. Use / to nest epics.",
    });
    if (epic?.trim()) this.changed.emit({ epic: epic.trim() });
  }

  protected async addLabel() {
    const label = await this.dialogs.prompt({ title: "New label", label: "Label", placeholder: "backend", confirm: "Add" });
    if (label) this.changed.emit({ labels: [...new Set([...this.value().labels, label])] });
  }
}
