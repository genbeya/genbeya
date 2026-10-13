/**
 * Suggestions while writing a comment, as the app's comment box offers
 * them: `[[` tasks, pages and files, `@` people, `//` dates. The list sits
 * below the field; arrows choose, Enter or Tab inserts, Escape closes.
 */
import { MENTION_TRIGGER, mentionSuggestions, mentionText } from "../../../client/app/editor/mention-suggestions";
import { DATE_TRIGGER, dateSuggestions } from "../../../client/app/editor/smart-dates";
import { referenceCandidates } from "../../../client/app/markdown/references";
import { formatDate, today } from "../../../client/app/ui/calendar-date";
import { markdownOptions } from "./markdown";
import type { MarkdownContext } from "./protocol";

interface Suggestion {
  readonly label: string;
  readonly detail: string;
  /** What replaces the typed trigger, given the text after the cursor. */
  readonly insert: (next: string) => string;
}

/** The text after an unclosed `[[` at the end of the line. */
const REFERENCE_TRIGGER = /\[\[([^\]|\n]*)$/;
const LIMIT = 30;

let lists = 0;

export class TextCompletion {
  private list: HTMLElement | null = null;
  private field: HTMLTextAreaElement | null = null;
  private suggestions: readonly Suggestion[] = [];
  private from = 0;
  private active = 0;
  private readonly id = `gb-completion-${++lists}`;

  /** Offers suggestions in the text fields below `root` that match `selector`, from what `context` returns. */
  constructor(
    root: HTMLElement,
    selector: string,
    private readonly context: () => MarkdownContext | null,
  ) {
    root.addEventListener("input", (event) => {
      const field = event.target as HTMLElement;
      if (field instanceof HTMLTextAreaElement && field.matches(selector)) this.update(field);
    });
    root.addEventListener("keydown", (event) => this.key(event), true);
    root.addEventListener("focusout", () => this.close());
  }

  private update(field: HTMLTextAreaElement) {
    const context = this.context();
    const caret = field.selectionStart;
    if (!context || caret !== field.selectionEnd) return this.close();
    const before = field.value.slice(0, caret);
    const line = before.slice(before.lastIndexOf("\n") + 1);
    const reference = REFERENCE_TRIGGER.exec(line);
    const mention = reference ? null : MENTION_TRIGGER.exec(line);
    const date = reference || mention ? null : DATE_TRIGGER.exec(line);
    if (reference) {
      const typed = reference[1]!.toLowerCase();
      const closed = (next: string) => next.startsWith("]]");
      this.suggestions = referenceCandidates(markdownOptions(context, "").references!)
        .filter((candidate) => candidate.label.toLowerCase().includes(typed))
        .sort((a, b) => Number(!a.label.toLowerCase().startsWith(typed)) - Number(!b.label.toLowerCase().startsWith(typed)))
        .slice(0, LIMIT)
        .map((candidate) => ({
          label: candidate.label,
          detail: candidate.detail ?? "file",
          insert: (next) => `[[${candidate.target}${closed(next) ? "" : "]]"}`,
        }));
    } else if (mention) {
      this.suggestions = mentionSuggestions(context.people, mention[1]!).map((person) => ({
        label: person.name,
        detail: `@${person.handle}`,
        insert: (next) => mentionText(person, next),
      }));
    } else if (date) {
      this.suggestions = dateSuggestions(date[1]!, today()).flatMap(({ label, date: iso }) =>
        iso ? [{ label, detail: formatDate(iso, { weekday: true }), insert: () => iso }] : [],
      );
    } else return this.close();
    this.field = field;
    this.from = caret - (reference ?? mention ?? date)![0].length;
    this.active = 0;
    if (this.suggestions.length) this.show();
    else this.close();
  }

  private key(event: KeyboardEvent) {
    if (!this.list || event.isComposing) return;
    const count = this.suggestions.length;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      this.active = (this.active + (event.key === "ArrowDown" ? 1 : count - 1)) % count;
      this.show();
    } else if ((event.key === "Enter" && !event.ctrlKey && !event.metaKey) || event.key === "Tab") this.apply(this.active);
    else if (event.key === "Escape") this.close();
    else return;
    event.preventDefault();
    event.stopPropagation();
  }

  private apply(index: number) {
    const field = this.field;
    const suggestion = this.suggestions[index];
    if (!field || !suggestion) return this.close();
    const caret = field.selectionStart;
    let next = field.value.slice(caret);
    const text = suggestion.insert(next);
    // A reference completed inside `[[…]]` keeps the brackets already there, and the cursor goes past them.
    const skip = text.startsWith("[[") && !text.endsWith("]]") && next.startsWith("]]") ? 2 : 0;
    next = next.slice(skip);
    field.value = field.value.slice(0, this.from) + text + (skip ? "]]" : "") + next;
    const end = this.from + text.length + skip;
    field.setSelectionRange(end, end);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    this.close();
  }

  private show() {
    const field = this.field!;
    if (!this.list) {
      this.list = document.createElement("div");
      this.list.id = this.id;
      this.list.className = "gb-completion";
      this.list.setAttribute("role", "listbox");
      this.list.setAttribute("aria-label", "Suggestions");
      // Inside the board's popup, which sits above everything else in the page.
      (field.closest("dialog") ?? document.body).append(this.list);
    }
    field.setAttribute("aria-controls", this.id);
    field.setAttribute("aria-expanded", "true");
    field.setAttribute("aria-activedescendant", `${this.id}-${this.active}`);
    const box = field.getBoundingClientRect();
    // Above the field when there is no room below it.
    const below = window.innerHeight - box.bottom > 220;
    Object.assign(this.list.style, {
      left: `${box.left}px`,
      top: below ? `${box.bottom + 2}px` : "",
      bottom: below ? "" : `${window.innerHeight - box.top + 2}px`,
    });
    this.list.replaceChildren(
      ...this.suggestions.map((suggestion, index) => {
        const option = document.createElement("div");
        option.id = `${this.id}-${index}`;
        option.className = "gb-completion-item";
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(index === this.active));
        const label = document.createElement("span");
        label.textContent = suggestion.label;
        const detail = document.createElement("span");
        detail.className = "gb-faint";
        detail.textContent = suggestion.detail;
        option.append(label, detail);
        // Keeps the focus in the field.
        option.addEventListener("mousedown", (event) => event.preventDefault());
        option.addEventListener("click", () => this.apply(index));
        return option;
      }),
    );
    this.list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }

  close() {
    this.list?.remove();
    this.list = null;
    this.field?.setAttribute("aria-expanded", "false");
    this.field?.removeAttribute("aria-activedescendant");
    this.field?.removeAttribute("aria-controls");
  }
}
