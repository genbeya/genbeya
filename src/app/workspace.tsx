import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Preferences, Snapshot } from "../../shared/api";
import { api, errorMessage } from "../api";
import { useToast } from "../components/Toasts";

interface Workspace {
  snapshot: Snapshot;
  busy: boolean;
  preferences: Preferences;
  refresh(): Promise<void>;
  /** Runs a repository action: tracks busy state, refreshes afterwards, toasts errors. */
  run<T>(action: () => Promise<T>, success?: string): Promise<T | undefined>;
  /** Call after wiki or task edits so a dedicated content branch can sync. */
  contentChanged(): void;
  setPreferences(value: Partial<Preferences>): Promise<void>;
}

const WorkspaceContext = createContext<Workspace | null>(null);

export const useWorkspace = () => {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) throw new Error("useWorkspace outside WorkspaceProvider");
  return workspace;
};

const POLL_INTERVAL = 4000;

export function WorkspaceProvider({
  initial,
  preferences,
  onPreferences,
  children,
}: {
  initial: Snapshot;
  preferences: Preferences;
  onPreferences(value: Preferences): void;
  children: ReactNode;
}) {
  const toast = useToast();
  const [snapshot, setSnapshot] = useState(initial);
  const [pending, setPending] = useState(0);
  const version = useRef(initial.version);
  const syncTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const refresh = useCallback(async () => {
    const next = await api().snapshot(version.current);
    if (next) {
      version.current = next.version;
      setSnapshot(next);
    }
  }, []);

  const run = useCallback(
    async <T,>(action: () => Promise<T>, success?: string) => {
      setPending((n) => n + 1);
      try {
        const result = await action();
        if (success) toast.success(success);
        return result;
      } catch (error) {
        toast.error(errorMessage(error));
        return undefined;
      } finally {
        await refresh().catch(() => undefined);
        setPending((n) => n - 1);
      }
    },
    [refresh, toast],
  );

  const storage = snapshot.storage;
  const autoSync = preferences.autoSyncContent && storage.mode === "branch" && !!storage.remote;
  const contentChanged = useCallback(() => {
    if (!autoSync) return;
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      void api()
        .syncContent()
        .then(refresh)
        .catch((error) => toast.error(errorMessage(error)));
    }, 2500);
  }, [autoSync, refresh, toast]);

  useEffect(() => {
    const tick = () => {
      if (!document.hidden) void refresh().catch(() => undefined);
    };
    const timer = setInterval(tick, POLL_INTERVAL);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", tick);
      clearTimeout(syncTimer.current);
    };
  }, [refresh]);

  const setPreferences = useCallback(
    async (value: Partial<Preferences>) => {
      try {
        onPreferences(await api().setPreferences(value));
      } catch (error) {
        toast.error(errorMessage(error));
      }
    },
    [onPreferences, toast],
  );

  const value = useMemo(
    () => ({ snapshot, busy: pending > 0, preferences, refresh, run, contentChanged, setPreferences }),
    [snapshot, pending, preferences, refresh, run, contentChanged, setPreferences],
  );
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
