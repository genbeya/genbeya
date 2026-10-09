/** Recent repositories in the Windows taskbar jump list. */
import { app } from "electron";
import { describeLocation, type RecentEntry } from "../../contracts/model";
import { launchArgument } from "../../utilities/launch-request";

const ENTRIES = 10;

export function updateJumpList(recent: readonly RecentEntry[]): void {
  if (process.platform !== "win32") return;
  // Unpackaged, electron.exe needs the app folder as its first argument.
  const prefix = app.isPackaged ? [] : [`"${app.getAppPath()}"`];
  try {
    app.setJumpList([
      {
        type: "custom",
        name: "Recent repositories",
        items: recent.slice(0, ENTRIES).map((entry) => ({
          type: "task" as const,
          title: entry.name,
          description: describeLocation(entry.location),
          program: process.execPath,
          args: [...prefix, launchArgument(entry.location)].join(" "),
          iconPath: process.execPath,
          iconIndex: 0,
        })),
      },
    ]);
  } catch {
    // The jump list is a convenience; Windows may refuse it.
  }
}
