import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked, ViewEncapsulation } from "@angular/core";
import { LucidePencil, LucidePlus, LucideTrash2 } from "@lucide/angular";
import type { Settings, StorageMode, Theme } from "../../../../contracts/model";
import { Dialogs } from "../../core/dialogs";
import { hotkey, MOD_KEY } from "../../core/hotkeys";
import { Session } from "../../core/session";
import { trackUnsaved } from "../../core/unsaved-changes";
import { WorkspaceApi } from "../../core/workspace-api";
import { titleCase } from "../tasks/task-model";
import { StatusEditor } from "./status-editor";

type TextSetting = "name" | "taskPrefix" | "wikiRoot" | "wikiHome" | "taskRoot";

/** Project settings (shared through .gitdesk.yml), content storage, remotes and personal preferences. */
@Component({
  selector: "gd-settings-view",
  imports: [StatusEditor, LucidePencil, LucidePlus, LucideTrash2],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrl: "./settings.css",
  host: { class: "view" },
  templateUrl: "./settings-view.html",
})
export class SettingsView {
  protected readonly session = inject(Session);
  private readonly api = inject(WorkspaceApi);
  private readonly dialogs = inject(Dialogs);
  protected readonly mod = MOD_KEY;
  protected readonly themes: readonly Theme[] = ["system", "light", "dark"];
  protected readonly titleCase = titleCase;
  protected readonly snapshot = computed(() => this.session.snapshot()!);

  /** The saved settings the form started from, and the file version they came from. */
  private readonly base = signal({ settings: this.snapshot().settings, hash: this.snapshot().settingsHash });
  protected readonly form = signal<Settings>(this.snapshot().settings);
  protected readonly dirty = computed(() => JSON.stringify(this.form()) !== JSON.stringify(this.base().settings));
  protected readonly prefix = computed(() => this.form().taskPrefix || "T");
  protected readonly contentBranch = computed(() => {
    const storage = this.snapshot().storage;
    return storage.mode === "branch" ? storage.branch : "gitdesk";
  });

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

  protected setStatuses(statuses: string[]) {
    this.form.update((form) => ({ ...form, statuses }));
  }

  protected discard() {
    this.form.set(this.base().settings);
  }

  protected async save() {
    const form = this.form();
    const saved = await this.session.run(async () => (await this.api.content.saveSettings(form, this.base().hash), true), "Settings saved");
    // The next snapshot brings the new version; until then the form counts as clean.
    if (saved) this.base.update((base) => ({ ...base, settings: form }));
  }

  protected async setStorage(mode: StorageMode) {
    if (mode === this.snapshot().storage.mode) return;
    const confirmed = await this.dialogs.confirm(
      mode === "branch"
        ? {
            title: "Store wiki and tasks on a dedicated branch",
            message:
              "GitDesk keeps wiki pages, tasks and settings on a branch named gitdesk, checked out separately inside .git. Every edit becomes a commit there, and code branches stay untouched. A new branch starts with the committed wiki and tasks of the current branch; the files on your code branches are left as they are.",
            confirm: "Use a dedicated branch",
          }
        : {
            title: "Store wiki and tasks in the checkout",
            message: "GitDesk reads the wiki and tasks from the checked-out branch again. The gitdesk branch is kept.",
            confirm: "Switch",
          },
    );
    if (confirmed) await this.session.run(() => this.api.content.setStorage(mode), "Storage updated");
  }

  protected async editRemote(name?: string, url?: string) {
    const remote =
      name ??
      (await this.dialogs.prompt({ title: "Add remote", label: "Name", initial: this.snapshot().remotes.length ? "" : "origin", placeholder: "origin", confirm: "Next" }));
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
    const confirmed = await this.dialogs.confirm({ title: "Remove remote", message: `Remove ${name} (${url})?`, confirm: "Remove", danger: true });
    if (confirmed) await this.session.run(() => this.api.versionControl.removeRemote(name), "Remote removed");
  }
}
