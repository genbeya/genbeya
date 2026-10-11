/**
 * `@mentions` and `//` dates for plain text areas, such as the comment
 * composer: the same suggestions as the Markdown editors, in a list below
 * the field. Arrow keys choose, Enter or Tab inserts, Escape closes.
 */
import { DestroyRef, Directive, ElementRef, inject, input } from "@angular/core";
import type { Person } from "../../../contracts/model";
import { formatDate, today } from "../ui/calendar-date";
import { openDatePicker } from "./date-picker";
import { MENTION_TRIGGER, mentionSuggestions, mentionText } from "./mention-suggestions";
import { DATE_TRIGGER, dateSuggestions } from "./smart-dates";

interface Suggestion {
  readonly label: string;
  readonly detail: string;
  /** Replaces the typed trigger; null asks for a date first. */
  readonly insert: (next: string) => string | null;
}

let lists = 0;

/** Inside an inline code span or a fenced code block, going by the backticks before the cursor. */
function inCode(before: string): boolean {
  const fences = before.split("\n").filter((line) => /^\s*(```|~~~)/.test(line)).length;
  const line = before.slice(before.lastIndexOf("\n") + 1);
  return fences % 2 === 1 || (line.match(/`/g)?.length ?? 0) % 2 === 1;
}

@Directive({
  selector: "textarea[gdTextCompletion]",
  host: {
    role: "combobox",
    "aria-autocomplete": "list",
    "aria-expanded": "false",
    "(input)": "update()",
    "(click)": "update()",
    "(keydown)": "key($event)",
    "(blur)": "close()",
  },
})
export class TextareaCompletion {
  /** Whom `@` offers. */
  readonly people = input.required<readonly Person[]>({ alias: "gdTextCompletion" });
  /** Today, `2026-10-11`; the computer's today unless given. */
  readonly today = input<string | null>(null);

  private readonly field = inject<ElementRef<HTMLTextAreaElement>>(ElementRef).nativeElement;
  private readonly id = `gd-text-completion-${++lists}`;
  private list: HTMLElement | null = null;
  private suggestions: readonly Suggestion[] = [];
  /** Where the typed trigger starts. */
  private from = 0;
  private active = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.close());
  }

  protected update() {
    const caret = this.field.selectionStart;
    if (caret !== this.field.selectionEnd) return this.close();
    const before = this.field.value.slice(0, caret);
    const line = before.slice(before.lastIndexOf("\n") + 1);
    const mention = MENTION_TRIGGER.exec(line);
    const date = mention ? null : DATE_TRIGGER.exec(line);
    if ((!mention && !date) || inCode(before)) return this.close();
    if (mention)
      this.suggestions = mentionSuggestions(this.people(), mention[1]!).map((person) => ({
        label: person.name,
        detail: `@${person.handle}`,
        insert: (next) => mentionText(person, next),
      }));
    else {
      const on = this.today() ?? today();
      this.suggestions = dateSuggestions(date![1]!, on).map(({ label, date: iso }) => ({
        label,
        detail: iso && !label.includes(iso.slice(0, 4)) ? formatDate(iso, { weekday: true }) : "",
        insert: () => iso,
      }));
    }
    this.from = caret - (mention ?? date)![0].length;
    this.active = 0;
    if (this.suggestions.length) this.show();
    else this.close();
  }

  protected key(event: KeyboardEvent) {
    // Enter and the arrows belong to an input method while it composes.
    if (!this.list || event.isComposing) return;
    const count = this.suggestions.length;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      this.active = (this.active + (event.key === "ArrowDown" ? 1 : count - 1)) % count;
      this.show();
    } else if ((event.key === "Enter" && !event.ctrlKey && !event.metaKey) || event.key === "Tab") this.apply(this.active);
    else if (event.key === "Escape") this.close();
    else return;
    // The field's own keys (Escape leaving the composer) do not run.
    event.preventDefault();
    event.stopPropagation();
  }

  close() {
    this.list?.remove();
    this.list = null;
    this.field.setAttribute("aria-expanded", "false");
    this.field.removeAttribute("aria-activedescendant");
    this.field.removeAttribute("aria-controls");
  }

  private show() {
    if (!this.list) {
      this.list = document.createElement("div");
      this.list.id = this.id;
      this.list.className = "menu text-completion";
      this.list.setAttribute("role", "listbox");
      this.list.setAttribute("aria-label", "Suggestions");
      document.body.append(this.list);
    }
    const box = this.field.getBoundingClientRect();
    Object.assign(this.list.style, { position: "fixed", left: `${box.left}px`, top: `${box.bottom + 4}px`, zIndex: "1100" });
    this.list.replaceChildren(
      ...this.suggestions.map((suggestion, index) => {
        const option = document.createElement("div");
        option.id = `${this.id}-${index}`;
        option.className = "menu-item";
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(index === this.active));
        const label = document.createElement("span");
        label.className = "grow ellipsis";
        label.textContent = suggestion.label;
        const detail = document.createElement("span");
        detail.className = "menu-hint";
        detail.textContent = suggestion.detail;
        option.append(label, detail);
        // Keeps the focus in the field.
        option.addEventListener("mousedown", (event) => event.preventDefault());
        option.addEventListener("click", () => this.apply(index));
        return option;
      }),
    );
    this.field.setAttribute("aria-expanded", "true");
    this.field.setAttribute("aria-controls", this.id);
    this.field.setAttribute("aria-activedescendant", `${this.id}-${this.active}`);
  }

  private apply(index: number) {
    const suggestion = this.suggestions[index];
    const [from, to] = [this.from, this.field.selectionStart];
    this.close();
    if (!suggestion) return;
    const insert = suggestion.insert(this.field.value.slice(to, to + 1));
    if (insert !== null) return this.replace(from, to, insert);
    const box = this.field.getBoundingClientRect();
    openDatePicker({
      at: { left: box.left, top: box.bottom + 4 },
      today: this.today() ?? today(),
      onPick: (date) => {
        this.field.focus();
        this.replace(from, to, date);
      },
      onCancel: () => this.field.focus(),
    });
  }

  /**
   * Replaces the text as typing does: the browser's insertText command
   * reports the input and keeps the change on the field's undo stack
   * (Chromium and WebKit both have it). Without it, as in tests, the text
   * is set directly.
   */
  private replace(from: number, to: number, text: string) {
    this.field.setSelectionRange(from, to);
    const typed = typeof document.execCommand === "function" && document.execCommand("insertText", false, text);
    if (!typed) {
      this.field.setRangeText(text, from, to, "end");
      this.field.dispatchEvent(new Event("input", { bubbles: true }));
    }
    this.close();
  }
}
