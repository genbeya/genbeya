import { CdkMenu, CdkMenuTrigger } from "@angular/cdk/menu";
import { ChangeDetectionStrategy, Component, computed, inject, input, output } from "@angular/core";
import { PRIORITIES, type TaskInput } from "../../../../contracts/model";
import { Dialogs } from "../../core/dialogs";
import { People } from "../../core/people";
import { Session } from "../../core/session";
import { Avatar } from "../../ui/avatar";
import { Icon } from "../../ui/icon";
import { MenuItem } from "../../ui/menu-item";
import { LabelChip, PriorityIcon, StatusIcon, TypeIcon } from "./task-icons";
import { compareEpics, epicName, epicsOf, labelsOf, peopleOf, titleCase, typesOf } from "./task-model";

/** Status, type, priority, assignee, labels and epic as compact menu buttons. */
@Component({
  selector: "gd-task-properties",
  imports: [Avatar, CdkMenu, CdkMenuTrigger, Icon, LabelChip, MenuItem, PriorityIcon, StatusIcon, TypeIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "task-properties" },
  template: `
    <button type="button" class="property" aria-label="Status" [cdkMenuTriggerFor]="statusMenu">
      <gd-status-icon [status]="value().status" [statuses]="statuses()" [iconName]="statusIcons()[value().status]" />{{
        titleCase(value().status)
      }}
    </button>
    @if (types().length) {
      <button type="button" class="property" aria-label="Type" [cdkMenuTriggerFor]="typeMenu">
        @if (value().type) {
          <gd-type-icon [type]="value().type!" [decorative]="true" />{{ titleCase(value().type!) }}
        } @else {
          <svg gd-icon name="shapes" [size]="13"></svg>No type
        }
      </button>
    }
    <button type="button" class="property" aria-label="Priority" [cdkMenuTriggerFor]="priorityMenu">
      <gd-priority-icon [priority]="value().priority" />{{ priorityName(value().priority) }}
    </button>
    <button type="button" class="property" aria-label="Assignee" [cdkMenuTriggerFor]="assigneeMenu">
      @if (value().assignee) {
        <gd-avatar [name]="directory.nameOf(value().assignee)" [size]="16" />{{ directory.nameOf(value().assignee) }}
      } @else {
        <svg gd-icon name="user" [size]="14"></svg>Unassigned
      }
    </button>
    <button type="button" class="property" aria-label="Epic" [cdkMenuTriggerFor]="epicMenu">
      <svg gd-icon name="folder" [size]="13"></svg>{{ epicName(value().epic) }}
    </button>
    <button type="button" class="property" aria-label="Labels" [cdkMenuTriggerFor]="labelMenu">
      @for (label of value().labels; track label) {
        <gd-label-chip [name]="label" />
      } @empty {
        <svg gd-icon name="tag" [size]="13"></svg>Labels
      }
    </button>

    <ng-template #statusMenu>
      <div class="menu" cdkMenu>
        @for (status of statuses(); track status) {
          <button gd-menu-item [checked]="status === value().status" (selected)="changed.emit({ status })">
            <gd-status-icon icon [status]="status" [statuses]="statuses()" [iconName]="statusIcons()[status]" />{{ titleCase(status) }}
          </button>
        }
      </div>
    </ng-template>
    <ng-template #typeMenu>
      <div class="menu" cdkMenu>
        <button gd-menu-item [checked]="!value().type" (selected)="changed.emit({ type: '' })">
          <svg icon gd-icon name="shapes" [size]="13"></svg>No type
        </button>
        @for (type of types(); track type.name) {
          <button gd-menu-item [checked]="type.name === value().type" (selected)="changed.emit({ type: type.name })">
            <gd-type-icon icon [type]="type.name" [decorative]="true" />{{ titleCase(type.name) }}
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
          <svg icon gd-icon name="user" [size]="14"></svg>Unassigned
        </button>
        @for (person of people(); track person.value) {
          <button
            gd-menu-item
            [checked]="person.value === assigned()"
            [hint]="person.handle ? '@' + person.handle : undefined"
            (selected)="changed.emit({ assignee: person.value })"
          >
            <gd-avatar icon [name]="person.name" [size]="16" />{{ person.name }}
          </button>
        }
        <div class="menu-separator"></div>
        <button gd-menu-item (selected)="assignSomeoneElse()"><svg icon gd-icon name="plus" [size]="14"></svg>Someone else…</button>
      </div>
    </ng-template>
    <ng-template #epicMenu>
      <div class="menu" cdkMenu>
        <button gd-menu-item [checked]="!value().epic" (selected)="changed.emit({ epic: '' })">
          <svg icon gd-icon name="folder" [size]="13"></svg>No epic
        </button>
        @for (epic of epics(); track epic) {
          <button gd-menu-item [checked]="epic === value().epic" (selected)="changed.emit({ epic })">
            <svg icon gd-icon name="folder" [size]="13"></svg>{{ epic }}
          </button>
        }
        <div class="menu-separator"></div>
        <button gd-menu-item (selected)="newEpic()"><svg icon gd-icon name="plus" [size]="14"></svg>New epic…</button>
      </div>
    </ng-template>
    <ng-template #labelMenu>
      <div class="menu" cdkMenu>
        @for (label of labels(); track label) {
          <button gd-menu-item [checked]="value().labels.includes(label)" (selected)="toggleLabel(label)">
            <svg icon gd-icon name="tag" [size]="13"></svg>{{ label }}
          </button>
        }
        @if (labels().length) {
          <div class="menu-separator"></div>
        }
        <button gd-menu-item (selected)="addLabel()"><svg icon gd-icon name="plus" [size]="14"></svg>New label…</button>
      </div>
    </ng-template>
  `,
})
export class TaskProperties {
  readonly value = input.required<TaskInput>();
  readonly changed = output<Partial<TaskInput>>();
  private readonly session = inject(Session);
  private readonly dialogs = inject(Dialogs);
  protected readonly directory = inject(People);
  protected readonly priorities = PRIORITIES;
  protected readonly titleCase = titleCase;
  protected readonly statuses = computed(() => this.session.snapshot()!.settings.statuses);
  protected readonly statusIcons = computed(() => this.session.snapshot()!.settings.statusIcons);
  /** The configured types, and this task's type even when it is not configured. */
  protected readonly types = computed(() => typesOf(this.session.snapshot()!.settings.types, [{ type: this.value().type ?? "" }]));
  /** The repository's people, assigned by handle, then assignees who are none of them. */
  protected readonly people = computed(() => [
    ...this.directory.list().map((person) => ({ value: person.handle, name: person.name, handle: person.handle })),
    ...peopleOf(this.session.snapshot()!.tasks)
      .filter((assignee) => !this.directory.find(assignee))
      .map((assignee) => ({ value: assignee, name: assignee, handle: null })),
  ]);
  /** Who the task is assigned to, as the menu names them. */
  protected readonly assigned = computed(() => this.directory.identify(this.value().assignee));
  protected readonly epicName = epicName;
  /** Epics of other tasks, and this one's even while it is the only task in it. */
  protected readonly epics = computed(() =>
    [...new Set([...epicsOf(this.session.snapshot()!.tasks), ...(this.value().epic ? [this.value().epic] : [])])].sort(compareEpics),
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
    const name = await this.dialogs.prompt({
      title: "Assign",
      label: "Name",
      placeholder: "alice",
      confirm: "Assign",
      hint: "A handle, a name or an email.",
    });
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
