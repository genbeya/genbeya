import { useCallback, useState } from "react";

const read = (key: string, fallback: number) => {
  try {
    const value = Number(localStorage.getItem("width:" + key));
    return value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
};

/** A panel width the user can drag; remembered per key. */
export function usePanelWidth(key: string, initial: number, min = 180, max = 560) {
  const [width, setWidth] = useState(() => read(key, initial));
  const [dragging, setDragging] = useState(false);
  const start = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const origin = e.clientX;
      const from = width;
      setDragging(true);
      const move = (m: PointerEvent) => setWidth(Math.min(max, Math.max(min, from + m.clientX - origin)));
      const up = (u: PointerEvent) => {
        setDragging(false);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        const final = Math.min(max, Math.max(min, from + u.clientX - origin));
        try {
          localStorage.setItem("width:" + key, String(final));
        } catch {
          /* Width is a convenience. */
        }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [width, key, min, max],
  );
  const handle = (
    <div
      className={`resizer ${dragging ? "is-dragging" : ""}`}
      role="separator"
      aria-orientation="vertical"
      onPointerDown={start}
      onDoubleClick={() => setWidth(initial)}
    />
  );
  return { width, handle };
}
