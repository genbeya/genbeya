import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked, ViewEncapsulation } from "@angular/core";
import { Router } from "@angular/router";
import {
  syncsContentBranch,
  type ContentArea,
  type FieldDefinition,
  type Settings,
  type StorageMode,
  type TaskType,
  type Theme,
} from "../../../../contracts/model";
import { APP_VERSION } from "../../core/app-version";
import { Clipboard } from "../../core/clipboard";
import { Dialogs } from "../../core/dialogs";
import { hotkey, MOD_KEY } from "../../core/hotkeys";
import { Session } from "../../core/session";
import { trackUnsaved } from "../../core/unsaved-changes";
import { WorkspaceApi } from "../../core/workspace-api";
import { Icon } from "../../ui/icon";
import { Onboarding } from "../onboarding/onboarding";
import { titleCase } from "../tasks/task-model";
import { AgentFiles } from "./agent-files";
import { AREA_NAMES } from "./content-areas";
import { FieldEditor } from "./field-editor";
import { StatusEditor } from "./status-editor";
import { TypeEditor } from "./type-editor";

type TextSetting = "name" | "taskPrefix" | "wikiRoot" | "wikiHome" | "taskRoot";

/** Project settings (shared through .gitdesk.yml), content storage, agent files, remotes, personal preferences and help. */
@Component({
  selector: "gd-settings-view",
  imports: [AgentFiles, FieldEditor, Icon, StatusEditor, TypeEditor],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrl: "./settings.css",
  host: { class: "view" },
  templateUrl: "./settings-view.html",
})
export class SettingsView {
  protected readonly session = inject(Session);
  protected readonly onboarding = inject(Onboarding);
  private readonly api = inject(WorkspaceApi);
  private readonly dialogs = inject(Dialogs);
  private readonly router = inject(Router);
  private readonly clipboard = inject(Clipboard);
  protected readonly mod = MOD_KEY;
  protected readonly version = APP_VERSION;
  protected readonly themes: readonly Theme[] = ["system", "light", "dark"];
  protected readonly titleCase = titleCase;
  protected readonly snapshot = computed(() => this.session.snapshot()!);

  /** The saved settings the form started from, and the file version they came from. */
  private readonly base = signal({ settings: this.snapshot().settings, hash: this.snapshot().settingsHash });
  protected readonly form = signal<Settings>(this.snapshot().settings);
  protected readonly dirty = computed(() => JSON.stringify(this.form()) !== JSON.stringify(this.base().settings));
  protected readonly prefix = computed(() => this.form().taskPrefix || "T");
  protected readonly storageModes: readonly { readonly mode: StorageMode; readonly label: string }[] = [
    { mode: "checkout", label: "Checkout" },
    { mode: "branch", label: "Content branch" },
  ];
  protected readonly areas = computed(() => {
    const { wikiRoot, taskRoot } = this.snapshot().settings;
    return [
      { area: "wiki", label: "Wiki", hint: `Pages and their images in ${wikiRoot}/.` },
      { area: "tasks", label: "Tasks", hint: `Task files in ${taskRoot}/.` },
      { area: "settings", label: "Project settings", hint: "The .gitdesk.yml file with the settings above." },
    ] as const;
  });
  /** The content branch while it has something to sync. */
  protected readonly sharedBranch = computed(() => {
    const storage = this.snapshot().storage;
    return syncsContentBranch(storage) ? storage.branch : null;
  });
  private readonly branchName = computed(() => this.snapshot().storage.branch?.name ?? "gitdesk");

  constructor() {
    // Follow saves and outside edits of .gitdesk.yml while the form is untouched.
    effect(() => {
      const { settings, settingsHash } = this.snapshot();
      untracked(() => {
        if (this.dirty() || settingsHash === this.base().hash) return;
        this.form.set(settings);
        this.base.set({ settings, hash: settingsHash });
      });
    });
    trackUnsaved(this.dirty);
    hotkey("mod+s", () => void this.save(), this.dirty);
  }

  protected set(key: TextSetting, value: string) {
    this.form.update((form) => ({ ...form, [key]: value }));
  }

  /** Removed states take their icons along. */
  protected setStatuses(statuses: string[]) {
    this.form.update((form) => ({
      ...form,
      statuses,
      statusIcons: Object.fromEntries(Object.entries(form.statusIcons).filter(([status]) => statuses.includes(status))),
    }));
  }

  protected setStatusIcons(statusIcons: Record<string, string>) {
    this.form.update((form) => ({ ...form, statusIcons }));
  }

  protected setTypes(types: TaskType[]) {
    this.form.update((form) => ({ ...form, types }));
  }

  protected setFields(fields: FieldDefinition[]) {
    this.form.update((form) => ({ ...form, fields }));
  }

  /**
   * Opens the type's template in the code view, creating it first if needed.
   * The code view shows the checkout, so a template on the content branch,
   * where the tasks live then, is named for editing elsewhere instead.
   */
  protected async editTemplate(type: string) {
    const path = await this.session.run(() => this.api.content.ensureTaskTemplate(type));
    if (!path) return;
    if (this.snapshot().storage.areas.tasks === "checkout") {
      await this.router.navigate(["/code"], { queryParams: { file: path } });
      return;
    }
    const copy = await this.dialogs.confirm({
      title: `The ${type} template`,
      message:
        `The template is ${path} on the ${this.branchName()} branch, with the tasks. The code view shows the checkout, ` +
        "so edit it in the branch's worktree inside .git (git worktree list names it), or move the tasks to the checkout.",
      confirm: "Copy path",
    });
    if (copy) await this.clipboard.copy(path, "Path");
  }

  protected discard() {
    this.form.set(this.base().settings);
  }

  protected async save() {
    const form = this.form();
    // The next snapshot brings the new version; until then the form counts as clean.
    await this.session.run(async () => {
      await this.api.content.saveSettings(form, this.base().hash);
      this.base.update((base) => ({ ...base, settings: form }));
    }, "Settings saved");
  }

  protected async setStorage(area: ContentArea, mode: StorageMode) {
    if (mode === this.snapshot().storage.areas[area]) return;
    const name = AREA_NAMES[area];
    const branch = this.branchName();
    const confirmed = await this.dialogs.confirm(
      mode === "branch"
        ? {
            title: `Keep ${name} on the content branch`,
            message: `GitDesk copies ${name} as last committed on the current branch onto the ${branch} branch, which is checked out separately inside .git, and commits every later edit there. The files on your code branches stay as they are; delete them in a normal commit once the team has switched. Everyone else follows when they sync.`,
            confirm: "Move to the content branch",
          }
        : {
            title: `Keep ${name} in the checkout`,
            message: `GitDesk copies ${name} from the ${branch} branch into your checkout as uncommitted changes; commit them like code. The ${branch} branch keeps its copy. Everyone else follows when they sync.`,
            confirm: "Move to the checkout",
          },
    );
    if (confirmed) await this.session.run(() => this.api.content.setStorage(area, mode), "Storage updated");
  }

  protected async editRemote(name?: string, url?: string) {
    const remote =
      name ??
      (await this.dialogs.prompt({
        title: "Add remote",
        label: "Name",
        initial: this.snapshot().remotes.length ? "" : "origin",
        placeholder: "origin",
        confirm: "Next",
      }));
    if (!remote) return;
    const address = await this.dialogs.prompt({
      title: name ? `Edit ${name}` : `Add ${remote}`,
      label: "URL or path",
      ...(url ? { initial: url } : {}),
      placeholder: "git@github.com:team/project.git",
      confirm: "Save",
      hint: "GitHub, GitLab, Bitbucket, any SSH or HTTPS server, or a local path.",
    });
    if (address) await this.session.run(() => this.api.versionControl.setRemote(remote, address), "Remote saved");
  }

  protected async removeRemote(name: string, url: string) {
    const confirmed = await this.dialogs.confirm({
      title: "Remove remote",
      message: `Remove ${name} (${url})?`,
      confirm: "Remove",
      danger: true,
    });
    if (confirmed) await this.session.run(() => this.api.versionControl.removeRemote(name), "Remote removed");
  }
}
