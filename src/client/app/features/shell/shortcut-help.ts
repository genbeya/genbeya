import { ChangeDetectionStrategy, Component } from "@angular/core";
import { CTRL_KEY, MOD_KEY, SHIFT_KEY } from "../../core/hotkeys";
import { DialogFrame } from "../../ui/dialog-frame";

const GROUPS: readonly (readonly [string, readonly (readonly [readonly string[], string])[]])[] = [
  [
    "Everywhere",
    [
      [[`${MOD_KEY} K`], "Search and commands"],
      [[`${MOD_KEY} ${SHIFT_KEY} F`], "Search inside files (or type / in the palette)"],
      [[`${MOD_KEY} 1–5`], "Wiki, Tasks, Code, Changes, History"],
      [["Alt ←", "Alt →"], "Back / forward (also mouse buttons)"],
      [[`${MOD_KEY} O`], "Open a folder"],
      [[`${MOD_KEY} ,`], "Settings"],
      [[`${CTRL_KEY} \``], "Show or hide the terminal"],
      [["/"], "Focus the filter"],
      [["?"], "This overview"],
    ],
  ],
  [
    "Wiki and tasks",
    [
      [["E"], "Edit the open page or task"],
      [["N"], "New page"],
      [["C"], "New task"],
      [[`${MOD_KEY} S`], "Save"],
      [["Esc"], "Stop editing / close"],
    ],
  ],
  ["Changes", [[[`${MOD_KEY} Enter`], "Commit"]]],
];

@Component({
  selector: "gd-shortcut-help",
  imports: [DialogFrame],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <gd-dialog-frame title="Keyboard shortcuts" [width]="480">
      @for (group of groups; track group[0]) {
        <section class="shortcut-group">
          <h3>{{ group[0] }}</h3>
          @for (row of group[1]; track row[1]) {
            <div class="shortcut-row">
              <span>{{ row[1] }}</span>
              <span class="row">
                @for (keys of row[0]; track keys; let last = $last) {
                  <kbd class="kbd">{{ keys }}</kbd>
                  @if (!last) {
                    <span class="faint">/</span>
                  }
                }
              </span>
            </div>
          }
        </section>
      }
    </gd-dialog-frame>
  `,
  styles: `
    .shortcut-group h3 {
      margin: 4px 0 6px;
      color: var(--text-3);
      font-size: 11.5px;
      font-weight: 600;
    }
    .shortcut-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 30px;
      gap: 4px;
    }
    .shortcut-row .row {
      gap: 4px;
    }
  `,
})
export class ShortcutHelp {
  protected readonly groups = GROUPS;
}
