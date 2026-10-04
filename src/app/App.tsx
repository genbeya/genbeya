import { useCallback, useEffect, useRef, useState } from "react";
import type { Location, Preferences, Snapshot } from "../../shared/api";
import { api, errorMessage } from "../api";
import { DialogProvider } from "../components/Dialog";
import { Spinner } from "../components/controls";
import { ToastProvider, useToast } from "../components/Toasts";
import { Welcome } from "../views/Welcome";
import { Shell } from "./Shell";
import { confirmDiscard, RouterProvider } from "./router";
import { WorkspaceProvider } from "./workspace";

const DEFAULT_PREFERENCES: Preferences = {
  theme: "system",
  reopenLast: true,
  autoSyncContent: false,
  plantumlServer: "",
};

export default function App() {
  if (!window.gitdesk)
    return (
      <div className="no-bridge">
        GitDesk is a desktop app. Start it with <code>npm run dev</code>.
      </div>
    );
  return (
    <ToastProvider>
      <DialogProvider>
        <Root />
      </DialogProvider>
    </ToastProvider>
  );
}

/** Owns which repository is open; everything below works on one workspace. */
function Root() {
  const toast = useToast();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [state, setState] = useState<"starting" | "idle" | "opening">("starting");
  const [session, setSession] = useState(0);

  useEffect(() => {
    void api().preferences().then(setPreferences);
    api()
      .restore()
      .then((restored) => {
        if (restored) {
          setSnapshot(restored);
          setSession((n) => n + 1);
        }
      })
      .catch(() => undefined)
      .finally(() => setState("idle"));
    const unsubscribe = api().onOpenRequest?.((location) => void openRef.current(location));
    return typeof unsubscribe === "function" ? unsubscribe : undefined;
  }, []);

  const open = useCallback(
    async (opening: () => Promise<Snapshot | null>) => {
      setState("opening");
      try {
        const next = await opening();
        if (next) {
          setSnapshot(next);
          setSession((n) => n + 1);
        }
      } catch (error) {
        toast.error(errorMessage(error));
      } finally {
        setState("idle");
      }
    },
    [toast],
  );

  // Every repository switch asks before discarding unsaved edits.
  const actions = {
    open: async (location: Location) => {
      if (confirmDiscard()) await open(() => api().open(location));
    },
    pick: async () => {
      if (!confirmDiscard()) return;
      await open(async () => {
        const location = await api().pickFolder();
        return location ? api().open(location) : null;
      });
    },
    clone: async (url: string, parent: Location) => {
      if (confirmDiscard()) await open(() => api().clone(url, parent));
    },
    close: async () => {
      if (!confirmDiscard()) return;
      await api().close();
      setSnapshot(null);
    },
  };
  const openRef = useRef(actions.open);
  openRef.current = actions.open;

  if (state === "starting")
    return (
      <div className="boot">
        <Spinner size={18} />
      </div>
    );
  if (!snapshot) return <Welcome busy={state === "opening"} actions={actions} />;
  return (
    <WorkspaceProvider key={session} initial={snapshot} preferences={preferences} onPreferences={setPreferences}>
      <RouterProvider initial={{ view: "wiki" }}>
        <Shell actions={actions} opening={state === "opening"} />
      </RouterProvider>
    </WorkspaceProvider>
  );
}

export type RepositoryActions = {
  open(location: Location): Promise<void>;
  pick(): Promise<void>;
  clone(url: string, parent: Location): Promise<void>;
  close(): Promise<void>;
};
