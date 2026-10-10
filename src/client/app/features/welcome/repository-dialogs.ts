/** Dialogs that name a repository elsewhere: on WSL or SSH, or a URL to clone. */
import { DIALOG_DATA, DialogRef } from "@angular/cdk/dialog";
import { ChangeDetectionStrategy, Component, computed, inject, input, model, output, signal } from "@angular/core";
import { LucideFolderOpen } from "@lucide/angular";
import { describeLocation, type Location, type RemoteLocation } from "../../../../contracts/model";
import { Dialogs } from "../../core/dialogs";
import { Repositories } from "../../core/repositories";
import { DialogFrame } from "../../ui/dialog-frame";
import { FolderBrowser, type FolderBrowserOptions, type FolderChoice } from "./folder-browser";

type Kind = "wsl" | "ssh";

/** Distribution or host, and a path; shared by both dialogs. */
@Component({
  selector: "gd-remote-fields",
  imports: [LucideFolderOpen],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: "display: contents" },
  template: `
    <div class="segmented" role="radiogroup" aria-label="Machine">
      <button
        type="button"
        role="radio"
        [attr.aria-checked]="kind() === 'wsl'"
        [class.is-active]="kind() === 'wsl'"
        [disabled]="!distributions().length"
        (click)="kind.set('wsl')"
      >
        WSL
      </button>
      <button
        type="button"
        role="radio"
        [attr.aria-checked]="kind() === 'ssh'"
        [class.is-active]="kind() === 'ssh'"
        (click)="kind.set('ssh')"
      >
        SSH
      </button>
    </div>
    @if (kind() === "wsl") {
      <label class="field">
        Distribution
        <select class="select" [value]="distro()" (change)="distro.set($any($event.target).value)">
          @for (name of distributions(); track name) {
            <option [value]="name">{{ name }}</option>
          }
        </select>
      </label>
    } @else {
      <label class="field">
        Host
        <input
          class="input"
          spellcheck="false"
          placeholder="user@server or a Host from ~/.ssh/config"
          [value]="host()"
          (input)="host.set($any($event.target).value)"
        />
      </label>
    }
    <div class="field">
      {{ pathLabel() }}
      <div class="row">
        <input
          class="input mono grow"
          spellcheck="false"
          placeholder="/home/me/project"
          [attr.aria-label]="pathLabel()"
          [value]="path()"
          (input)="path.set($any($event.target).value)"
        />
        <button type="button" class="btn btn-default btn-m" [disabled]="!machine()" (click)="browse()">
          <svg lucideFolderOpen [size]="14" aria-hidden="true"></svg><span>Browse…</span>
        </button>
      </div>
    </div>
  `,
})
export class RemoteFields {
  private readonly dialogs = inject(Dialogs);
  readonly pathLabel = input.required<string>();
  /** Lets the folder browser open a Git repository right away, through {@link openRepository}. */
  readonly openRepositories = input(false);
  readonly kind = model<Kind>("wsl");
  readonly distro = model("");
  readonly host = model("");
  readonly path = model("");
  /** The folder browser chose a repository to open; it is in {@link path}. */
  readonly openRepository = output();
  protected readonly distributions = signal<readonly string[]>([]);
  /** The machine to browse, or null until it is named. */
  protected readonly machine = computed(() => remoteLocation(this.kind(), this.distro(), this.host(), "/"));

  constructor() {
    void inject(Repositories)
      .distributions()
      .then((names) => {
        this.distributions.set(names);
        if (names.length && !this.distro()) this.distro.set(names[0]!);
        if (!names.length) this.kind.set("ssh");
      });
  }

  /** Browses from the typed folder, or from the home folder. */
  protected async browse() {
    const machine = this.machine();
    if (!machine) return;
    const typed = this.path().trim();
    const location = { ...machine, path: /^(\/|~(\/|$))/.test(typed) ? typed : "" };
    const choice = await this.dialogs.open<FolderChoice, FolderBrowserOptions>(FolderBrowser, {
      location,
      openRepositories: this.openRepositories(),
    });
    if (!choice) return;
    this.path.set(choice.path);
    if (choice.open) this.openRepository.emit();
  }
}

/** The location the fields describe, or null while incomplete. */
function remoteLocation(kind: Kind, distro: string, host: string, path: string): RemoteLocation | null {
  const trimmed = path.trim();
  if (!trimmed.startsWith("/")) return null;
  if (kind === "wsl") return distro ? { kind, distro, path: trimmed } : null;
  return host.trim() ? { kind, host: host.trim(), path: trimmed } : null;
}

@Component({
  selector: "gd-remote-dialog",
  imports: [DialogFrame, RemoteFields],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <gd-dialog-frame title="Open a repository on WSL or SSH" [width]="480" (submitted)="submit()">
      <gd-remote-fields
        pathLabel="Repository path"
        [openRepositories]="true"
        [(kind)]="kind"
        [(distro)]="distro"
        [(host)]="host"
        [(path)]="path"
        (openRepository)="submit()"
      />
      <p class="dialog-hint">
        Git runs on the remote machine. SSH uses your <code>ssh</code> configuration and agent; connect once in a terminal so the host key
        is trusted.
      </p>
      <footer>
        <button type="button" class="btn btn-default btn-m" (click)="dialog.close()"><span>Cancel</span></button>
        <button type="submit" class="btn btn-primary btn-m" [disabled]="!location()"><span>Open</span></button>
      </footer>
    </gd-dialog-frame>
  `,
})
export class RemoteDialog {
  protected readonly dialog = inject<DialogRef<Location>>(DialogRef);
  protected readonly kind = signal<Kind>("wsl");
  protected readonly distro = signal("");
  protected readonly host = signal("");
  protected readonly path = signal("");
  protected readonly location = computed(() => remoteLocation(this.kind(), this.distro(), this.host(), this.path()));

  protected submit() {
    const location = this.location();
    if (location) this.dialog.close(location);
  }
}

/** A URL and where to clone it; the dialog's data is a URL to start with, such as the remote of a GitDesk link. */
@Component({
  selector: "gd-clone-dialog",
  imports: [DialogFrame, RemoteFields, LucideFolderOpen],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <gd-dialog-frame title="Clone a repository" [width]="500" (submitted)="submit()">
      <label class="field">
        Repository URL
        <input
          class="input mono"
          spellcheck="false"
          placeholder="git@github.com:team/project.git"
          [value]="url()"
          (input)="url.set($any($event.target).value)"
        />
      </label>
      <div class="segmented" role="radiogroup" aria-label="Clone to">
        <button type="button" role="radio" [attr.aria-checked]="!remote()" [class.is-active]="!remote()" (click)="remote.set(false)">
          This computer
        </button>
        <button type="button" role="radio" [attr.aria-checked]="remote()" [class.is-active]="remote()" (click)="remote.set(true)">
          WSL or SSH
        </button>
      </div>
      @if (remote()) {
        <gd-remote-fields pathLabel="Into folder" [(kind)]="kind" [(distro)]="distro" [(host)]="host" [(path)]="path" />
      } @else {
        <div class="field">
          Into folder
          <div class="row">
            <input
              class="input mono grow"
              readonly
              aria-label="Parent folder"
              placeholder="Choose a parent folder"
              [value]="folderText()"
            />
            <button type="button" class="btn btn-default btn-m" (click)="chooseFolder()">
              <svg lucideFolderOpen [size]="14" aria-hidden="true"></svg><span>Choose…</span>
            </button>
          </div>
        </div>
      }
      <p class="dialog-hint">Authentication uses your existing Git credentials and SSH keys.</p>
      <footer>
        <button type="button" class="btn btn-default btn-m" (click)="dialog.close()"><span>Cancel</span></button>
        <button type="submit" class="btn btn-primary btn-m" [disabled]="!valid()"><span>Clone</span></button>
      </footer>
    </gd-dialog-frame>
  `,
})
export class CloneDialog {
  protected readonly dialog = inject<DialogRef<{ url: string; parent: Location }>>(DialogRef);
  private readonly repositories = inject(Repositories);
  protected readonly url = signal(inject<string | undefined>(DIALOG_DATA) ?? "");
  protected readonly remote = signal(false);
  protected readonly folder = signal<Location | null>(null);
  protected readonly kind = signal<Kind>("wsl");
  protected readonly distro = signal("");
  protected readonly host = signal("");
  protected readonly path = signal("");
  protected readonly folderText = computed(() => {
    const folder = this.folder();
    return folder ? describeLocation(folder) : "";
  });
  private readonly parent = computed(() =>
    this.remote() ? remoteLocation(this.kind(), this.distro(), this.host(), this.path()) : this.folder(),
  );
  protected readonly valid = computed(() => !!this.url().trim() && !!this.parent());

  protected async chooseFolder() {
    const folder = await this.repositories.pickFolder();
    if (folder) this.folder.set(folder);
  }

  protected submit() {
    const parent = this.parent();
    if (this.valid() && parent) this.dialog.close({ url: this.url().trim(), parent });
  }
}
