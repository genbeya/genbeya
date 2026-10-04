import { app } from "electron";
import { describeLocation, type Location, type RecentEntry } from "../shared/api.js";
import { validateLocation } from "../core/hosts.js";

const FLAG = "--open=";

const encode = (location: Location) => FLAG + Buffer.from(JSON.stringify(location)).toString("base64url");

/** The repository passed with `--open=…` (from the jump list), if any. */
export function locationFromArgs(argv: string[]): Location | null {
  const arg = argv.find((a) => a.startsWith(FLAG));
  if (!arg) return null;
  try {
    return validateLocation(JSON.parse(Buffer.from(arg.slice(FLAG.length), "base64url").toString("utf8")));
  } catch {
    return null;
  }
}

/** Recent repositories in the Windows taskbar jump list. */
export function updateJumpList(recent: RecentEntry[]) {
  if (process.platform !== "win32") return;
  // Unpackaged, electron.exe needs the app folder as its first argument.
  const prefix = app.isPackaged ? [] : [`"${app.getAppPath()}"`];
  try {
    app.setJumpList([
      {
        type: "custom",
        name: "Recent repositories",
        items: recent.slice(0, 10).map((entry) => ({
          type: "task" as const,
          title: entry.name,
          description: describeLocation(entry.location),
          program: process.execPath,
          args: [...prefix, encode(entry.location)].join(" "),
          iconPath: process.execPath,
          iconIndex: 0,
        })),
      },
    ]);
  } catch {
    /* The jump list is a convenience; Windows may refuse it. */
  }
}
