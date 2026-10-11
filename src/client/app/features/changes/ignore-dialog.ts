import { DIALOG_DATA, DialogRef } from "@angular/cdk/dialog";
import { ChangeDetectionStrategy, Component, computed, inject, signal } from "@angular/core";
import type { IgnoreKind } from "../../../../contracts/model";
import { extensionOf, ignoreFile, ignoreLocations, ignoreRule } from "../../../../utilities/gitignore";
import { DialogFrame } from "../../ui/dialog-frame";

/** What to ignore: a file, a folder, or every file with the extension of `path`. */
export interface IgnoreRequest {
  readonly path: string;
  readonly kind: IgnoreKind;
  /** Git tracks it, so ignoring alone changes nothing until it stops tracking it. */
  readonly tracked: boolean;
}

/** The folder whose .gitignore gets the rule ("" for the root), and whether Git stops tracking the path. */
export interface IgnoreChoice {
  readonly location: string;
  readonly untrack: boolean;
}

const TITLES: Readonly<Record<IgnoreKind, string>> = {
  file: "Ignore file",
  folder: "Ignore folder",
  extension: "Ignore files by extension",
};

/** Asks which .gitignore gets the rule, showing the line it adds; closes with the choice, or nothing when cancelled. */
@Component({
  selector: "gd-ignore-dialog",
  imports: [DialogFrame],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <gd-dialog-frame [title]="title" (submitted)="submit()">
      <p class="dialog-message">
        @switch (request.kind) {
          @case ("folder") {
            Git leaves out the folder <code>{{ request.path }}</code> and everything in it.
          }
          @case ("extension") {
            Git leaves out every <code>*.{{ extension }}</code> file below the folder of the .gitignore.
          }
          @default {
            Git leaves out <code>{{ request.path }}</code
            >.
          }
        }
      </p>
      <label class="field">
        Add the rule to
        <select #field class="select" [value]="location()" (change)="location.set(field.value)">
          @for (folder of locations; track folder) {
            <option [value]="folder">{{ fileOf(folder) }}</option>
          }
        </select>
      </label>
      <div class="field">
        Line to add
        <pre class="ignore-preview mono" aria-live="polite">{{ rule() }}</pre>
      </div>
      @if (request.tracked) {
        <label class="checkbox">
          <input #stop type="checkbox" [checked]="untrack()" (change)="untrack.set(stop.checked)" />
          Stop tracking {{ request.kind === "folder" ? "its files" : request.path }}
        </label>
        <p class="dialog-hint">
          Git ignores only files it does not track. Stopping keeps them on disk; the next commit deletes them from the repository.
        </p>
      }
      <footer>
        <button type="button" class="btn btn-default btn-m" (click)="dialog.close()"><span>Cancel</span></button>
        <button type="submit" class="btn btn-primary btn-m"><span>Add to .gitignore</span></button>
      </footer>
    </gd-dialog-frame>
  `,
  styles: `
    .ignore-preview {
      margin: 0;
      padding: 7px 10px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--bg-code);
      color: var(--text);
      font-size: 12.5px;
      white-space: pre-wrap;
      word-break: break-all;
    }
  `,
})
export class IgnoreDialog {
  protected readonly dialog = inject<DialogRef<IgnoreChoice>>(DialogRef);
  protected readonly request = inject<IgnoreRequest>(DIALOG_DATA);
  protected readonly title =
    this.request.kind === "extension" ? `Ignore all *.${extensionOf(this.request.path)} files` : TITLES[this.request.kind];
  protected readonly extension = extensionOf(this.request.path);
  protected readonly locations = ignoreLocations(this.request.path);
  protected readonly location = signal("");
  protected readonly untrack = signal(true);
  protected readonly rule = computed(() => ignoreRule(this.request.kind, this.request.path, this.location()) ?? "");
  protected readonly fileOf = ignoreFile;

  protected submit() {
    this.dialog.close({ location: this.location(), untrack: this.request.tracked && this.untrack() });
  }
}
