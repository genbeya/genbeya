import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import "./Tree.css";

export interface TreeItem {
  key: string;
  label: string;
  icon?: ReactNode;
  children?: TreeItem[];
  /** Whether selecting the row opens something (directories may not). */
  selectable?: boolean;
  actions?: ReactNode;
  title?: string;
}

/**
 * A keyboard-friendly tree. Expansion is remembered per key; rows with
 * children expand when filtered so matches are visible.
 */
export function Tree({
  items,
  selected,
  onSelect,
  expandAll = false,
  label,
  initiallyExpanded,
}: {
  items: TreeItem[];
  selected: string | null;
  onSelect(item: TreeItem): void;
  expandAll?: boolean;
  label: string;
  initiallyExpanded?: (item: TreeItem) => boolean;
}) {
  const [toggled, setToggled] = useState<Map<string, boolean>>(new Map());
  // Ancestors of the selection open automatically unless the user closed them.
  const ancestors = new Set<string>();
  const trail = (nodes: TreeItem[], path: string[]): boolean =>
    nodes.some((n) => {
      if (n.key === selected) return path.forEach((k) => ancestors.add(k)), true;
      return n.children ? trail(n.children, [...path, n.key]) : false;
    });
  if (selected) trail(items, []);
  const isOpen = (item: TreeItem) =>
    expandAll ||
    (toggled.get(item.key) ?? (ancestors.has(item.key) || (initiallyExpanded?.(item) ?? false)));
  const toggle = (item: TreeItem) =>
    setToggled((old) => new Map(old).set(item.key, !isOpen(item)));

  const render = (nodes: TreeItem[], depth: number): ReactNode =>
    nodes.map((item) => {
      const open = isOpen(item);
      const hasChildren = !!item.children?.length;
      return (
        <div key={item.key} role="none">
          <div
            role="treeitem"
            aria-selected={selected === item.key}
            aria-expanded={hasChildren ? open : undefined}
            tabIndex={selected === item.key ? 0 : -1}
            className={`tree-row ${selected === item.key ? "is-selected" : ""}`}
            style={{ paddingLeft: 6 + depth * 14 }}
            title={item.title}
            onClick={() => (item.selectable === false ? toggle(item) : onSelect(item))}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSelect(item);
              if (e.key === "ArrowRight" && hasChildren && !open) toggle(item);
              if (e.key === "ArrowLeft" && hasChildren && open) toggle(item);
            }}
          >
            <span
              className={`tree-twisty ${hasChildren ? "" : "is-leaf"} ${open ? "is-open" : ""}`}
              onClick={(e) => {
                if (!hasChildren) return;
                e.stopPropagation();
                toggle(item);
              }}
            >
              {hasChildren && <ChevronRight size={12} />}
            </span>
            {item.icon && <span className="tree-icon">{item.icon}</span>}
            <span className="tree-label">{item.label}</span>
            {item.actions && (
              <span className="tree-actions" onClick={(e) => e.stopPropagation()}>
                {item.actions}
              </span>
            )}
          </div>
          {hasChildren && open && <div role="group">{render(item.children!, depth + 1)}</div>}
        </div>
      );
    });

  return (
    <div className="tree" role="tree" aria-label={label}>
      {render(items, 0)}
    </div>
  );
}

/** Keeps items whose label (or a descendant's) matches the query. */
export function filterTree(items: TreeItem[], query: string): TreeItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.flatMap((item) => {
    const children = item.children ? filterTree(item.children, q) : [];
    if (item.label.toLowerCase().includes(q)) return [{ ...item, children: item.children }];
    return children.length ? [{ ...item, children }] : [];
  });
}
