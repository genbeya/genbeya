import { Dialog } from "../components/Dialog";
import { Kbd } from "../components/controls";
import { modKey } from "./hotkeys";

const GROUPS: [string, [string, string][]][] = [
  [
    "Everywhere",
    [
      [`${modKey} K`, "Search and commands"],
      [`${modKey} 1–5`, "Wiki, Tasks, Code, Changes, History"],
      ["Alt ← / Alt →", "Back / forward (also mouse buttons)"],
      [`${modKey} O`, "Open a folder"],
      [`${modKey} ,`, "Settings"],
      ["/", "Focus the filter"],
      ["?", "This overview"],
    ],
  ],
  [
    "Wiki and tasks",
    [
      ["E", "Edit the open page or task"],
      ["N", "New page"],
      ["C", "New task"],
      [`${modKey} S`, "Save"],
      ["Esc", "Stop editing / close"],
    ],
  ],
  ["Changes", [[`${modKey} Enter`, "Commit"]]],
];

export function ShortcutHelp({ onClose }: { onClose(): void }) {
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose} width={480}>
      {GROUPS.map(([group, rows]) => (
        <section key={group} className="shortcut-group">
          <h3>{group}</h3>
          {rows.map(([keys, label]) => (
            <div className="shortcut-row" key={label}>
              <span>{label}</span>
              <span className="row">
                {keys.split(" ").map((k, i) => (k === "/" && keys.includes("←") ? <span key={i} className="faint">/</span> : <Kbd key={i}>{k}</Kbd>))}
              </span>
            </div>
          ))}
        </section>
      ))}
    </Dialog>
  );
}
