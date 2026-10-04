import { useEffect, useRef } from "react";

/**
 * `useHotkey("mod+s", fn)`: "mod" is Ctrl (or Cmd on macOS). Plain-key
 * shortcuts ("e", "c", "/") are ignored while typing in a field or editor.
 */
export function useHotkey(
  combo: string | string[],
  handler: (event: KeyboardEvent) => void,
  enabled = true,
) {
  const ref = useRef(handler);
  ref.current = handler;
  const combos = (Array.isArray(combo) ? combo : [combo]).join(" ");
  useEffect(() => {
    if (!enabled) return;
    const parsed = combos.split(" ").map(parse);
    const listener = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (parsed.some((c) => matches(c, event))) {
        event.preventDefault();
        ref.current(event);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [combos, enabled]);
}

const mac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

interface Combo {
  key: string;
  mod: boolean;
  alt: boolean;
  shift: boolean;
}

function parse(text: string): Combo {
  const parts = text.toLowerCase().split("+");
  return {
    key: parts[parts.length - 1],
    mod: parts.includes("mod"),
    alt: parts.includes("alt"),
    shift: parts.includes("shift"),
  };
}

export function typing(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  return !!element?.closest?.("input, textarea, select, [contenteditable=true], .monaco-editor");
}

function matches(combo: Combo, event: KeyboardEvent) {
  const mod = mac ? event.metaKey : event.ctrlKey;
  if (combo.mod !== mod || combo.alt !== event.altKey) return false;
  const key = event.key.toLowerCase();
  if (combo.key !== key && !(combo.key === "?" && key === "?")) return false;
  if (combo.key !== "?" && combo.shift !== event.shiftKey) return false;
  // Single-key shortcuts never fire while the user types; Escape always does.
  return combo.mod || combo.alt || combo.key === "escape" || !typing(event.target);
}

export const modKey = mac ? "⌘" : "Ctrl";
