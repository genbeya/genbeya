import { useCallback, useEffect, useRef, useState } from "react";
import type { FileContent, Scope } from "../../shared/api";
import { api, errorMessage } from "../api";
import { useWorkspace } from "./workspace";

/**
 * Loads a file and keeps it current with the disk. While `editing`, newer
 * disk content is not swapped in (the draft is based on the loaded version);
 * `changedOnDisk` reports it instead.
 */
export function useFile(scope: Scope, path: string | undefined, editing = false) {
  const { snapshot } = useWorkspace();
  const [file, setFile] = useState<FileContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [changedOnDisk, setChangedOnDisk] = useState(false);
  const editingRef = useRef(editing);
  editingRef.current = editing;

  const load = useCallback(async () => {
    if (!path) return;
    try {
      const next = await api().read(scope, path);
      setFile(next);
      setError(null);
      setChangedOnDisk(false);
    } catch (e) {
      setFile(null);
      setError(errorMessage(e));
    }
  }, [scope, path]);

  useEffect(() => {
    setFile(null);
    setError(null);
    void load();
  }, [load]);

  // The snapshot version changes whenever the repository does.
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    api()
      .read(scope, path)
      .then((next) => {
        if (cancelled) return;
        setFile((current) => {
          if (current?.hash === next.hash) return current;
          if (editingRef.current && current) {
            setChangedOnDisk(true);
            return current;
          }
          return next;
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [snapshot.version]);

  return { file, setFile, error, changedOnDisk, reload: load };
}

export const stripFrontmatter = (text: string) => text.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n/, "");
