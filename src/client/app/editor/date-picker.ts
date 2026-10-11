/**
 * A small calendar for picking a date while writing, for the editors'
 * `//` completion. Arrow keys move by day and week, Page Up and Page Down
 * by month, Enter picks, Escape gives up, Tab goes to the month buttons.
 * Plain DOM, like CodeMirror's own panels, so it works over any editor.
 */
import { addDays, addMonths, formatDate, today as todayOf, weekday } from "../ui/calendar-date";

export interface DatePickerOptions {
  /** Where the calendar's top left corner goes, in viewport pixels. */
  readonly at: { readonly left: number; readonly top: number };
  readonly today?: string;
  /** The day selected first; today unless given. */
  readonly initial?: string;
  readonly onPick: (date: string) => void;
  readonly onCancel: () => void;
}

const WEEKDAY_NAMES = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const KEY_STEPS: Readonly<Record<string, number>> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

let ids = 0;

/** Opens the calendar; it closes itself once a date is picked or given up on, also by a click elsewhere. Returns a function that closes it. */
export function openDatePicker(options: DatePickerOptions): () => void {
  const today = options.today ?? todayOf();
  let selected = options.initial ?? today;
  const prefix = `gd-date-${++ids}`;

  const root = document.createElement("div");
  root.className = "date-picker";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Pick a date");
  Object.assign(root.style, { position: "fixed", left: `${options.at.left}px`, top: `${options.at.top}px`, zIndex: "1100" });

  const header = document.createElement("div");
  header.className = "date-picker-header";
  const month = document.createElement("span");
  month.id = `${prefix}-month`;
  month.setAttribute("aria-live", "polite");
  const button = (label: string, text: string, months: number) => {
    const element = document.createElement("button");
    element.type = "button";
    element.className = "icon-btn";
    element.setAttribute("aria-label", label);
    element.title = label;
    element.textContent = text;
    // Keeps the focus in the grid.
    element.addEventListener("mousedown", (event) => event.preventDefault());
    element.addEventListener("click", () => select(addMonths(selected, months)));
    return element;
  };
  const [previous, next] = [button("Previous month", "‹", -1), button("Next month", "›", 1)];
  header.append(previous, month, next);

  const grid = document.createElement("div");
  grid.className = "date-picker-grid";
  grid.setAttribute("role", "grid");
  grid.setAttribute("aria-labelledby", month.id);
  grid.tabIndex = 0;
  const hint = document.createElement("div");
  hint.className = "date-picker-hint";
  hint.textContent = "Arrows move, Enter picks, Esc closes";
  root.append(header, grid, hint);

  function draw() {
    const [year, monthNumber] = selected.split("-").map(Number) as [number, number];
    const first = `${year}-${String(monthNumber).padStart(2, "0")}-01`;
    month.textContent = new Intl.DateTimeFormat(undefined, { timeZone: "UTC", month: "long", year: "numeric" }).format(
      new Date(Date.UTC(year, monthNumber - 1, 1)),
    );
    // Weeks start on Monday.
    const start = addDays(first, -((weekday(first) + 6) % 7));
    const row = (cells: HTMLElement[]) => {
      const element = document.createElement("div");
      element.className = "date-picker-row";
      element.setAttribute("role", "row");
      element.append(...cells);
      return element;
    };
    const names = WEEKDAY_NAMES.map((name) => {
      const cell = document.createElement("span");
      cell.className = "date-picker-weekday";
      cell.setAttribute("role", "columnheader");
      cell.textContent = name;
      return cell;
    });
    const cells: HTMLElement[] = [];
    for (let index = 0; index < 42; index++) {
      const date = addDays(start, index);
      const day = document.createElement("span");
      day.id = `${prefix}-${date}`;
      day.className = "date-picker-day";
      if (!date.startsWith(first.slice(0, 7))) day.classList.add("is-other-month");
      if (date === today) day.classList.add("is-today");
      day.setAttribute("role", "gridcell");
      day.setAttribute("aria-selected", String(date === selected));
      day.setAttribute("aria-label", formatDate(date, { weekday: true }));
      day.textContent = String(Number(date.slice(8)));
      day.addEventListener("mousedown", (event) => event.preventDefault());
      day.addEventListener("click", () => pick(date));
      cells.push(day);
    }
    const weeks = Array.from({ length: 6 }, (_, week) => row(cells.slice(week * 7, week * 7 + 7)));
    grid.replaceChildren(row(names), ...weeks);
    grid.setAttribute("aria-activedescendant", `${prefix}-${selected}`);
  }

  function select(date: string) {
    selected = date;
    draw();
  }

  let open = true;
  function close() {
    if (!open) return;
    open = false;
    document.removeEventListener("mousedown", outside, true);
    root.remove();
  }
  function pick(date: string) {
    close();
    options.onPick(date);
  }
  function cancel() {
    close();
    options.onCancel();
  }
  function outside(event: MouseEvent) {
    if (!root.contains(event.target as Node)) cancel();
  }

  grid.addEventListener("keydown", (event) => {
    const step = KEY_STEPS[event.key];
    if (step !== undefined) select(addDays(selected, step));
    else if (event.key === "PageUp" || event.key === "PageDown") select(addMonths(selected, event.key === "PageUp" ? -1 : 1));
    else if (event.key === "Home") select(today);
    else if (event.key === "Enter" || event.key === " ") pick(selected);
    else return;
    event.preventDefault();
    event.stopPropagation();
  });
  // Tab goes round the month buttons and the days, staying in the calendar; Escape gives up from anywhere in it.
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") cancel();
    else if (event.key === "Tab") {
      const stops = [previous, next, grid];
      const at = stops.indexOf(document.activeElement as HTMLButtonElement);
      stops[(at + (event.shiftKey ? stops.length - 1 : 1)) % stops.length]!.focus();
    } else return;
    event.preventDefault();
    event.stopPropagation();
  });

  draw();
  document.body.append(root);
  // Kept inside the window.
  const box = root.getBoundingClientRect();
  if (box.right > innerWidth - 8) root.style.left = `${Math.max(8, innerWidth - 8 - box.width)}px`;
  if (box.bottom > innerHeight - 8) root.style.top = `${Math.max(8, options.at.top - box.height - 28)}px`;
  document.addEventListener("mousedown", outside, true);
  grid.focus();
  return close;
}
