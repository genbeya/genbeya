import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type View = "wiki" | "tasks" | "code" | "changes" | "history" | "settings";

export type Route =
  | { view: "wiki"; page?: string; dir?: string; anchor?: string }
  | { view: "tasks"; task?: string; create?: string }
  | { view: "code"; file?: string }
  | { view: "changes"; file?: string; staged?: boolean }
  | { view: "history"; commit?: string; file?: string }
  | { view: "settings"; section?: string };

interface Router {
  route: Route;
  navigate(route: Route, options?: { replace?: boolean }): boolean;
  back(): void;
  forward(): void;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Registers unsaved work; navigation asks before discarding it. */
  setDirty(key: string, dirty: boolean): void;
  confirmLeave(): boolean;
}

const RouterContext = createContext<Router | null>(null);

export const useRouter = () => {
  const router = useContext(RouterContext);
  if (!router) throw new Error("useRouter outside RouterProvider");
  return router;
};

const same = (a: Route, b: Route) => JSON.stringify(a) === JSON.stringify(b);

let activeGuard: () => boolean = () => true;
/** Asks before discarding unsaved work; usable outside the router (repository switches). */
export const confirmDiscard = () => activeGuard();

/** In-app history: Alt+Left/Right and the mouse's back/forward buttons walk it. */
export function RouterProvider({ initial, children }: { initial: Route; children: ReactNode }) {
  const [history, setHistory] = useState({ entries: [initial], index: 0 });
  const dirty = useRef(new Set<string>());

  const confirmLeave = useCallback(
    () => dirty.current.size === 0 || window.confirm("Discard unsaved changes?"),
    [],
  );

  const latest = useRef(history);
  latest.current = history;

  useEffect(() => {
    activeGuard = confirmLeave;
    // Closing or reloading the window asks the main process, which shows a dialog.
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty.current.size) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      activeGuard = () => true;
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [confirmLeave]);

  const navigate = useCallback(
    (route: Route, options?: { replace?: boolean }) => {
      // Staying on the same route keeps unsaved work and its tracking.
      if (same(latest.current.entries[latest.current.index], route)) return true;
      if (!confirmLeave()) return false;
      dirty.current.clear();
      setHistory(({ entries, index }) => {
        if (options?.replace) {
          const next = [...entries];
          next[index] = route;
          return { entries: next, index };
        }
        const next = [...entries.slice(0, index + 1), route].slice(-200);
        return { entries: next, index: next.length - 1 };
      });
      return true;
    },
    [confirmLeave],
  );

  const step = useCallback(
    (delta: number) => {
      const h = latest.current;
      const index = h.index + delta;
      if (index < 0 || index >= h.entries.length || !confirmLeave()) return;
      dirty.current.clear();
      setHistory({ ...h, index });
    },
    [confirmLeave],
  );

  const value = useMemo<Router>(
    () => ({
      route: history.entries[history.index],
      navigate,
      back: () => step(-1),
      forward: () => step(1),
      canGoBack: history.index > 0,
      canGoForward: history.index < history.entries.length - 1,
      setDirty: (key, value) => {
        if (value) dirty.current.add(key);
        else dirty.current.delete(key);
      },
      confirmLeave,
    }),
    [history, navigate, step, confirmLeave],
  );

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}
