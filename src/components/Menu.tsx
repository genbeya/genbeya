import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import "./Menu.css";

export type MenuItem =
  | {
      label: string;
      icon?: ReactNode;
      hint?: ReactNode;
      checked?: boolean;
      danger?: boolean;
      disabled?: boolean;
      onSelect(): void;
    }
  | { heading: string }
  | "separator";

/**
 * A popover menu opened from `trigger`. `trigger` receives the toggle
 * function so any element can open it.
 */
export function Menu({
  trigger,
  items,
  align = "start",
  width = 220,
}: {
  trigger(props: { open: boolean; toggle(): void; ref: React.Ref<HTMLButtonElement> }): ReactNode;
  items: MenuItem[] | (() => MenuItem[]);
  align?: "start" | "end";
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      {trigger({ open, toggle: () => setOpen((o) => !o), ref: anchor })}
      {open && anchor.current && (
        <Popover
          anchor={anchor.current}
          align={align}
          width={width}
          items={typeof items === "function" ? items() : items}
          close={() => setOpen(false)}
        />
      )}
    </>
  );
}

function Popover({
  anchor,
  items,
  align,
  width,
  close,
}: {
  anchor: HTMLElement;
  items: MenuItem[];
  align: "start" | "end";
  width: number;
  close(): void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [focus, setFocus] = useState(-1);
  const actionable = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => typeof item === "object" && "onSelect" in item && !item.disabled);

  useLayoutEffect(() => {
    const rect = anchor.getBoundingClientRect();
    const height = panel.current?.offsetHeight ?? 0;
    const top = rect.bottom + 4 + height > window.innerHeight ? Math.max(8, rect.top - height - 4) : rect.bottom + 4;
    const left = align === "end" ? rect.right - width : rect.left;
    setPosition({ top, left: Math.max(8, Math.min(left, window.innerWidth - width - 8)) });
  }, [anchor, align, width]);

  useEffect(() => {
    const outside = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
    };
    const keydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        setFocus((f) => (f + step + actionable.length) % actionable.length);
      } else if (e.key === "Enter" && focus >= 0) {
        e.preventDefault();
        const entry = actionable[focus]?.item;
        if (entry && typeof entry === "object" && "onSelect" in entry) {
          close();
          entry.onSelect();
        }
      }
    };
    document.addEventListener("mousedown", outside);
    window.addEventListener("keydown", keydown, true);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("mousedown", outside);
      window.removeEventListener("keydown", keydown, true);
      window.removeEventListener("blur", close);
    };
  }, [anchor, close, focus, actionable]);

  return createPortal(
    <div ref={panel} className="menu" role="menu" style={{ ...position, width }}>
      {items.map((item, index) => {
        if (item === "separator") return <div key={index} className="menu-separator" />;
        if ("heading" in item)
          return (
            <div key={index} className="menu-heading">
              {item.heading}
            </div>
          );
        const focused = actionable[focus]?.index === index;
        return (
          <button
            key={index}
            role="menuitem"
            disabled={item.disabled}
            className={`menu-item ${item.danger ? "is-danger" : ""} ${focused ? "is-focused" : ""}`}
            onMouseEnter={() => setFocus(actionable.findIndex((a) => a.index === index))}
            onClick={() => {
              close();
              item.onSelect();
            }}
          >
            <span className="menu-icon">{item.checked ? <Check size={14} /> : item.icon}</span>
            <span className="grow ellipsis">{item.label}</span>
            {item.hint && <span className="menu-hint">{item.hint}</span>}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
