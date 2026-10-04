import { createContext, useContext, useEffect, useState } from "react";
import { useHotkey } from "./hotkeys";
import { useRouter, type View } from "./router";
import type { RepositoryActions } from "./App";
import { Sidebar } from "./Sidebar";
import { Palette, type PaletteMode } from "./Palette";
import { ShortcutHelp } from "./ShortcutHelp";
import { CloneDialog, RemoteDialog } from "../views/RepositoryDialogs";
import { WikiView } from "../views/wiki/WikiView";
import { TasksView } from "../views/tasks/TasksView";
import { CodeView } from "../views/code/CodeView";
import { ChangesView } from "../views/changes/ChangesView";
import { HistoryView } from "../views/history/HistoryView";
import { SettingsView } from "../views/settings/SettingsView";
import "./Shell.css";

type Overlay = { kind: "palette"; mode: PaletteMode } | { kind: "help" } | { kind: "remote" } | { kind: "clone" } | null;

interface ShellControls {
  openPalette(mode?: PaletteMode): void;
  showHelp(): void;
  openRemote(): void;
  openClone(): void;
  repository: RepositoryActions;
}

const ShellContext = createContext<ShellControls | null>(null);
export const useShell = () => useContext(ShellContext)!;

const VIEWS: View[] = ["wiki", "tasks", "code", "changes", "history"];

export function Shell({ actions, opening }: { actions: RepositoryActions; opening: boolean }) {
  const router = useRouter();
  const [overlay, setOverlay] = useState<Overlay>(null);

  const controls: ShellControls = {
    openPalette: (mode = "all") => setOverlay({ kind: "palette", mode }),
    showHelp: () => setOverlay({ kind: "help" }),
    openRemote: () => setOverlay({ kind: "remote" }),
    openClone: () => setOverlay({ kind: "clone" }),
    repository: actions,
  };

  useHotkey(["mod+k", "mod+p"], () => controls.openPalette());
  useHotkey("mod+o", () => void actions.pick());
  useHotkey("?", () => controls.showHelp());
  useHotkey("alt+arrowleft", router.back);
  useHotkey("alt+arrowright", router.forward);
  useHotkey(["mod+1", "mod+2", "mod+3", "mod+4", "mod+5"], (e) =>
    router.navigate({ view: VIEWS[Number(e.key) - 1] } as never),
  );
  useHotkey("mod+,", () => router.navigate({ view: "settings" }));

  // Mouse back/forward buttons.
  useEffect(() => {
    const mouse = (e: MouseEvent) => {
      if (e.button === 3 || e.button === 4) {
        e.preventDefault();
        if (e.button === 3) router.back();
        else router.forward();
      }
    };
    window.addEventListener("mouseup", mouse);
    return () => window.removeEventListener("mouseup", mouse);
  }, [router.back, router.forward]);

  const view = router.route.view;
  return (
    <ShellContext.Provider value={controls}>
      <div className="shell">
        <Sidebar />
        <main className="main" aria-busy={opening}>
          {view === "wiki" && <WikiView />}
          {view === "tasks" && <TasksView />}
          {view === "code" && <CodeView />}
          {view === "changes" && <ChangesView />}
          {view === "history" && <HistoryView />}
          {view === "settings" && <SettingsView />}
        </main>
      </div>
      {overlay?.kind === "palette" && <Palette mode={overlay.mode} onClose={() => setOverlay(null)} />}
      {overlay?.kind === "help" && <ShortcutHelp onClose={() => setOverlay(null)} />}
      {overlay?.kind === "remote" && (
        <RemoteDialog onClose={() => setOverlay(null)} onOpen={(l) => (setOverlay(null), void actions.open(l))} />
      )}
      {overlay?.kind === "clone" && (
        <CloneDialog onClose={() => setOverlay(null)} onClone={(u, p) => (setOverlay(null), void actions.clone(u, p))} />
      )}
    </ShellContext.Provider>
  );
}
