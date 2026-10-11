import { openDatePicker } from "./date-picker";

function open() {
  const onPick = vi.fn();
  const onCancel = vi.fn();
  const close = openDatePicker({ at: { left: 0, top: 0 }, today: "2026-10-11", onPick, onCancel });
  onTestFinished(close);
  const picker = document.querySelector<HTMLElement>(".date-picker")!;
  const grid = picker.querySelector<HTMLElement>("[role='grid']")!;
  const key = (target: HTMLElement, key: string, init: KeyboardEventInit = {}) =>
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  const button = (name: string) => picker.querySelector<HTMLButtonElement>(`button[aria-label='${name}']`)!;
  return { picker, grid, key, button, onPick, onCancel };
}

describe("date picker", () => {
  it("lays the days out in rows of a grid named after the month", () => {
    const { grid } = open();
    const rows = [...grid.children];
    expect(rows.every((row) => row.getAttribute("role") === "row")).toBe(true);
    expect(rows).toHaveLength(7);
    expect([...rows[0]!.children].map((cell) => cell.getAttribute("role"))).toEqual(Array(7).fill("columnheader"));
    expect(rows.slice(1).every((row) => [...row.children].every((cell) => cell.getAttribute("role") === "gridcell"))).toBe(true);
    const label = document.getElementById(grid.getAttribute("aria-labelledby")!);
    expect(label?.textContent).toMatch(/2026/);
    expect(document.activeElement).toBe(grid);
  });

  it("moves the focus between the month buttons and the days with Tab, staying open", () => {
    const { grid, key, button, onCancel, picker } = open();
    key(grid, "Tab");
    expect(document.activeElement).toBe(button("Previous month"));
    key(button("Previous month"), "Tab");
    expect(document.activeElement).toBe(button("Next month"));
    key(button("Next month"), "Tab");
    expect(document.activeElement).toBe(grid);
    key(grid, "Tab", { shiftKey: true });
    expect(document.activeElement).toBe(button("Next month"));
    button("Next month").click();
    expect(grid.getAttribute("aria-activedescendant")).toMatch(/2026-11-11$/);
    expect(onCancel).not.toHaveBeenCalled();
    key(button("Next month"), "Escape");
    expect(onCancel).toHaveBeenCalledOnce();
    expect(picker.isConnected).toBe(false);
  });
});
