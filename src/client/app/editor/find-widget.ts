/**
 * Find and replace, floating at the top right of the editor like VS Code's:
 * match case, whole word, regular expressions (replacements take $1),
 * find in selection, and a running "3 of 12". CodeMirror's search state
 * holds the query; this panel shows and edits it.
 */
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  search,
  SearchQuery,
  searchPanelOpen,
  selectMatches,
  setSearchQuery,
} from "@codemirror/search";
import { EditorSelection, type EditorState, type Extension, StateEffect, StateField, type Text } from "@codemirror/state";
import { type Command, Decoration, EditorView, type KeyBinding, type Panel, runScopeHandlers, type ViewUpdate } from "@codemirror/view";
import { isMac, MOD_KEY } from "../core/hotkeys";
import { iconElement } from "../ui/icon";
import type { IconName } from "../ui/icon-data";

/** Counting stops here, so a pattern that matches everywhere in a huge file stays fast. */
export const MATCH_LIMIT = 2000;

export interface MatchCount {
  readonly total: number;
  /** More matches exist than were counted. */
  readonly capped: boolean;
  /** The selected match, from 1; 0 when the selection is on none (or one past the limit). */
  readonly current: number;
}

interface Range {
  readonly from: number;
  readonly to: number;
}

/** The matches of a query in the document, in order, up to the limit. */
export interface Matches {
  readonly ranges: readonly Range[];
  /** More matches exist than were found. */
  readonly capped: boolean;
}

export function findMatches(state: EditorState, query: SearchQuery, limit = MATCH_LIMIT): Matches {
  const ranges: Range[] = [];
  const cursor = query.getCursor(state);
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    if (ranges.length === limit) return { ranges, capped: true };
    ranges.push({ from: next.value.from, to: next.value.to });
  }
  return { ranges, capped: false };
}

/** The count, with the match `selection` is on found by binary search: matches are in document order. */
export function countOf({ ranges, capped }: Matches, selection: Range): MatchCount {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const { from, to } = ranges[middle]!;
    if (from < selection.from) low = middle + 1;
    else if (from > selection.from) high = middle - 1;
    else return { total: ranges.length, capped, current: to === selection.to ? middle + 1 : 0 };
  }
  return { total: ranges.length, capped, current: 0 };
}

export const countMatches = (state: EditorState, query: SearchQuery, limit = MATCH_LIMIT): MatchCount =>
  countOf(findMatches(state, query, limit), state.selection.main);

export function describeCount({ total, capped, current }: MatchCount): string {
  return total ? `${current || "?"} of ${total}${capped ? "+" : ""}` : "No results";
}

/** What screen readers hear: the number of results, without the position, which every cursor move changes. */
export function announceCount({ total, capped }: MatchCount): string {
  return total ? `${total}${capped ? "+" : ""} ${total === 1 && !capped ? "result" : "results"}` : "No results";
}

interface Scope {
  readonly from: number;
  readonly to: number;
}

/** The range "find in selection" searches; null searches everywhere. */
const setScope = StateEffect.define<Scope | null>();
const scopeMark = Decoration.mark({ class: "cm-findScope" });
const scopeField = StateField.define<Scope | null>({
  create: () => null,
  update(scope, transaction) {
    for (const effect of transaction.effects) if (effect.is(setScope)) return effect.value;
    // Text typed or replaced at either end stays inside.
    return scope && transaction.docChanged
      ? { from: transaction.changes.mapPos(scope.from, -1), to: transaction.changes.mapPos(scope.to, 1) }
      : scope;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (scope) =>
      scope && scope.to > scope.from ? Decoration.set(scopeMark.range(scope.from, scope.to)) : Decoration.none,
    ),
});

const inScope = (_match: string, state: EditorState, from: number, to: number) => {
  const scope = state.field(scopeField, false);
  return !scope || (from >= scope.from && to <= scope.to);
};

interface QueryOptions {
  readonly search: string;
  readonly replace: string;
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
  readonly regexp: boolean;
  readonly scoped: boolean;
}

/** Plain searches are literal, as in VS Code; regular expressions take \n and \t in replacements. */
const queryFrom = ({ scoped, ...options }: QueryOptions) =>
  new SearchQuery({ ...options, literal: !options.regexp, ...(scoped ? { test: inScope } : {}) });

const optionsOf = (query: SearchQuery): QueryOptions => ({
  search: query.search,
  replace: query.replace,
  caseSensitive: query.caseSensitive,
  wholeWord: query.wholeWord,
  regexp: query.regexp,
  scoped: query.test === inScope,
});

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Toggle = "caseSensitive" | "wholeWord" | "regexp" | "scoped";

/** The open panel of each editor, for the commands. */
const panels = new WeakMap<EditorView, FindPanel>();

function button(label: string, icon: IconName, onClick: () => void, pressed?: boolean): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.title = label;
  element.setAttribute("aria-label", label);
  if (pressed !== undefined) element.setAttribute("aria-pressed", String(pressed));
  element.append(iconElement(icon, 16));
  element.addEventListener("click", onClick);
  return element;
}

function field(label: string, mainField: boolean): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = label;
  input.spellcheck = false;
  input.autocomplete = "off";
  input.setAttribute("aria-label", label);
  if (mainField) input.setAttribute("main-field", "true");
  return input;
}

const div = (className: string, ...children: Node[]) => {
  const element = document.createElement("div");
  element.className = className;
  element.append(...children);
  return element;
};

/** How a shortcut reads on this platform, for tooltips. */
const keys = (windows: string, mac: string) => (isMac ? mac : windows);

class FindPanel implements Panel {
  readonly top = true;
  readonly dom: HTMLElement;
  readonly findField = field("Find", true);
  readonly replaceField = field("Replace", false);
  private readonly expander: HTMLButtonElement;
  private readonly replaceRow: HTMLElement;
  private readonly findBox: HTMLElement;
  private readonly count = document.createElement("span");
  private readonly announcer = document.createElement("span");
  /** The matches of the query in the text they were found in; moving the cursor only looks the selected one up. */
  private found: { readonly doc: Text; readonly query: SearchQuery; readonly scope: Scope | null; readonly matches: Matches } | null = null;
  private readonly toggles: Record<Toggle, HTMLButtonElement>;
  private readonly matchButtons: HTMLButtonElement[];

  constructor(private readonly view: EditorView) {
    const toggle = (option: Toggle, label: string, icon: IconName) => button(label, icon, () => this.toggle(option), false);
    this.toggles = {
      caseSensitive: toggle("caseSensitive", `Match case (${keys("Alt+C", "⌥⌘C")})`, "case-sensitive"),
      wholeWord: toggle("wholeWord", `Match whole word (${keys("Alt+W", "⌥⌘W")})`, "whole-word"),
      regexp: toggle("regexp", `Use regular expression (${keys("Alt+R", "⌥⌘R")})`, "regex"),
      scoped: toggle("scoped", `Find in selection (${keys("Alt+L", "⌥⌘L")})`, "scan-text"),
    };
    const previous = button("Previous match (Shift+Enter)", "arrow-up", () => findPrevious(view));
    const next = button("Next match (Enter)", "arrow-down", () => findNext(view));
    const replace = button("Replace (Enter)", "replace", () => replaceNext(view));
    const replaceEverything = button(`Replace all (${MOD_KEY}+Alt+Enter)`, "replace-all", () => replaceAll(view));
    this.matchButtons = [previous, next, replace, replaceEverything];
    this.expander = button("Toggle replace", "chevron-right", () => this.showReplace(!!this.replaceRow.hidden));
    this.expander.classList.add("cm-find-expander");
    this.expander.setAttribute("aria-expanded", "false");
    this.count.className = "cm-find-count";
    this.announcer.className = "sr-only";
    this.announcer.setAttribute("role", "status");
    this.findBox = div("cm-find-field", this.findField, this.toggles.caseSensitive, this.toggles.wholeWord, this.toggles.regexp);
    const findRow = div(
      "cm-find-row",
      this.findBox,
      this.count,
      previous,
      next,
      this.toggles.scoped,
      button("Close (Escape)", "x", () => closeFind(view)),
    );
    this.replaceRow = div("cm-find-row", div("cm-find-field", this.replaceField), replace, replaceEverything);
    this.replaceRow.hidden = true;
    this.dom = div("cm-find", this.expander, div("cm-find-rows", findRow, this.replaceRow), this.announcer);
    this.dom.setAttribute("role", "search");
    this.dom.setAttribute("aria-label", "Find and replace");
    this.dom.addEventListener("keydown", (event) => this.keydown(event));
    this.findField.addEventListener("input", () => {
      this.commit({ search: this.findField.value });
      this.selectNearestMatch();
    });
    this.replaceField.addEventListener("input", () => this.commit({ replace: this.replaceField.value }));
    const query = getSearchQuery(view.state);
    this.show(query);
    this.refreshCount(query);
    panels.set(view, this);
  }

  mount() {
    this.focus(this.findField);
  }

  update(update: ViewUpdate) {
    const query = getSearchQuery(update.state);
    const changed = query !== getSearchQuery(update.startState);
    if (changed) this.show(query);
    if (changed || update.docChanged || update.selectionSet) this.refreshCount(query);
  }

  destroy() {
    panels.delete(this.view);
  }

  focus(input: HTMLInputElement) {
    input.focus();
    input.select();
  }

  showReplace(shown: boolean) {
    this.replaceRow.hidden = !shown;
    this.expander.setAttribute("aria-expanded", String(shown));
    this.dom.classList.toggle("is-replacing", shown);
  }

  /** Sets the searched text, as Ctrl+F does with the selection. */
  prefill(text: string) {
    const query = getSearchQuery(this.view.state);
    this.commit({ search: query.regexp ? escapeRegExp(text) : text });
  }

  toggle(option: Toggle) {
    const options = optionsOf(getSearchQuery(this.view.state));
    if (option !== "scoped") return this.commit({ [option]: !options[option] } as Partial<QueryOptions>);
    const { state } = this.view;
    const { from, to } = state.selection.main;
    // Without a selection, the cursor's line is searched.
    const scope = from === to ? state.doc.lineAt(from) : { from, to };
    this.view.dispatch({
      effects: [
        setScope.of(options.scoped ? null : { from: scope.from, to: scope.to }),
        setSearchQuery.of(queryFrom({ ...options, scoped: !options.scoped })),
      ],
    });
  }

  private commit(change: Partial<QueryOptions>) {
    const current = getSearchQuery(this.view.state);
    const query = queryFrom({ ...optionsOf(current), ...change });
    if (!query.eq(current)) this.view.dispatch({ effects: setSearchQuery.of(query) });
  }

  /** Searching as the user types: the first match from the cursor on is selected. */
  private selectNearestMatch() {
    const { state } = this.view;
    const query = getSearchQuery(state);
    if (!query.valid) return;
    const start = state.selection.main.from;
    const first = (from: number, to?: number) => {
      const next = query.getCursor(state, from, to).next();
      return next.done ? null : next.value;
    };
    const match = first(start) ?? first(0, start);
    if (match)
      this.view.dispatch({
        selection: EditorSelection.single(match.from, match.to),
        effects: EditorView.scrollIntoView(match.from, { y: "center" }),
        userEvent: "select.search",
      });
  }

  private show(query: SearchQuery) {
    if (this.findField.value !== query.search) this.findField.value = query.search;
    if (this.replaceField.value !== query.replace) this.replaceField.value = query.replace;
    const options = optionsOf(query);
    for (const option of Object.keys(this.toggles) as Toggle[]) this.toggles[option].setAttribute("aria-pressed", String(options[option]));
  }

  private refreshCount(query: SearchQuery) {
    const { state } = this.view;
    const invalid = !!query.search && !query.valid;
    const scope = state.field(scopeField, false) ?? null;
    const found = this.found;
    if (query.valid && (!found || found.doc !== state.doc || found.query !== query || found.scope !== scope))
      this.found = { doc: state.doc, query, scope, matches: findMatches(state, query) };
    const count = query.valid ? countOf(this.found!.matches, state.selection.main) : null;
    this.findBox.classList.toggle("is-invalid", invalid);
    this.findField.setAttribute("aria-invalid", String(invalid));
    this.count.textContent = invalid ? "Invalid pattern" : count ? describeCount(count) : "";
    const announcement = invalid ? "Invalid pattern" : count && query.search ? announceCount(count) : "";
    if (this.announcer.textContent !== announcement) this.announcer.textContent = announcement;
    this.count.classList.toggle("is-empty", invalid || count?.total === 0);
    for (const element of this.matchButtons) element.disabled = !count?.total;
  }

  private keydown(event: KeyboardEvent) {
    if (runScopeHandlers(this.view, event, "search-panel")) return event.preventDefault();
    if (event.key !== "Enter" || event.isComposing) return;
    if (event.target === this.findField) {
      event.preventDefault();
      if (!event.altKey) return void (event.shiftKey ? findPrevious : findNext)(this.view);
      // Alt+Enter selects every match, for typing over all of them.
      selectMatches(this.view);
      this.view.focus();
    } else if (event.target === this.replaceField) {
      event.preventDefault();
      const all = event.altKey && (isMac ? event.metaKey : event.ctrlKey);
      (all ? replaceAll : replaceNext)(this.view);
    }
  }
}

function openFind(view: EditorView, replace: boolean): boolean {
  const { state } = view;
  const { from, to } = state.selection.main;
  const previous = getSearchQuery(state);
  const inPanel = !!panels.get(view)?.dom.contains(view.root.activeElement);
  // A selection within one line is what to look for, unless the panel is in use; longer ones keep the last query.
  const sameLine = from < to && state.doc.lineAt(from).number === state.doc.lineAt(to).number;
  const selected = sameLine && !inPanel ? state.sliceDoc(from, to) : null;
  openSearchPanel(view);
  const panel = panels.get(view);
  if (!panel) return false;
  // Opening resets the query to CodeMirror's default; the replacement and options carry on.
  view.dispatch({ effects: setSearchQuery.of(previous) });
  if (selected) panel.prefill(selected);
  panel.showReplace(replace);
  // As in VS Code, replacing goes on to the replacement once the query is given.
  panel.focus(replace && (selected || inPanel) ? panel.replaceField : panel.findField);
  return true;
}

/** Closes the panel; the next search covers the whole file again. */
const closeFind: Command = (view) => {
  if (!searchPanelOpen(view.state)) return false;
  const query = getSearchQuery(view.state);
  if (query.test === inScope)
    view.dispatch({ effects: [setScope.of(null), setSearchQuery.of(queryFrom({ ...optionsOf(query), scoped: false }))] });
  return closeSearchPanel(view);
};

const toggleOption =
  (option: Toggle): Command =>
  (view) => {
    const panel = panels.get(view);
    panel?.toggle(option);
    return !!panel;
  };

export const openFindCommand: Command = (view) => openFind(view, false);
export const openReplaceCommand: Command = (view) => openFind(view, true);

export const findKeymap: readonly KeyBinding[] = [
  { key: "Mod-f", run: openFindCommand, scope: "editor search-panel", preventDefault: true },
  { key: "Mod-h", mac: "Mod-Alt-f", run: openReplaceCommand, scope: "editor search-panel", preventDefault: true },
  { key: "F3", run: findNext, shift: findPrevious, scope: "editor search-panel", preventDefault: true },
  { mac: "Mod-g", run: findNext, shift: findPrevious, scope: "editor search-panel", preventDefault: true },
  { key: "Escape", run: closeFind, scope: "editor search-panel" },
  { key: "Alt-c", mac: "Mod-Alt-c", run: toggleOption("caseSensitive"), scope: "search-panel" },
  { key: "Alt-w", mac: "Mod-Alt-w", run: toggleOption("wholeWord"), scope: "search-panel" },
  { key: "Alt-r", mac: "Mod-Alt-r", run: toggleOption("regexp"), scope: "search-panel" },
  { key: "Alt-l", mac: "Mod-Alt-l", run: toggleOption("scoped"), scope: "search-panel" },
];

const theme = EditorView.theme({
  ".cm-panels-top": { borderBottom: "none" },
  ".cm-find": {
    position: "absolute",
    top: "6px",
    right: "18px",
    display: "flex",
    alignItems: "stretch",
    gap: "2px",
    maxWidth: "calc(100% - 36px)",
    padding: "4px 6px 4px 2px",
    borderRadius: "var(--radius)",
    background: "var(--bg-overlay)",
    boxShadow: "var(--shadow-pop)",
    color: "var(--text)",
    fontFamily: "var(--font-ui)",
    fontSize: "12.5px",
  },
  ".cm-find-rows": { display: "flex", flexDirection: "column", gap: "4px", minWidth: "0" },
  ".cm-find-row": { display: "flex", alignItems: "center", gap: "2px" },
  ".cm-find-row[hidden]": { display: "none" },
  ".cm-find-field": {
    display: "flex",
    alignItems: "center",
    gap: "1px",
    flex: "0 1 268px",
    minWidth: "120px",
    height: "26px",
    padding: "0 2px 0 8px",
    border: "1px solid var(--line-strong)",
    borderRadius: "var(--radius-s)",
    background: "var(--bg-input)",
  },
  ".cm-find-field:focus-within": { borderColor: "var(--accent)" },
  ".cm-find-field.is-invalid": { borderColor: "var(--red)" },
  ".cm-find-field input": {
    flex: "1",
    minWidth: "0",
    height: "100%",
    padding: "0",
    border: "none",
    outline: "none",
    background: "transparent",
    color: "inherit",
    font: "12px var(--font-mono)",
  },
  ".cm-find-field input::placeholder": { color: "var(--text-3)", fontFamily: "var(--font-ui)" },
  ".cm-find button": {
    display: "inline-grid",
    placeItems: "center",
    flex: "none",
    width: "24px",
    height: "24px",
    padding: "0",
    border: "none",
    borderRadius: "var(--radius-s)",
    background: "transparent",
    color: "var(--text-2)",
    cursor: "pointer",
  },
  ".cm-find-field button": { width: "22px", height: "20px" },
  ".cm-find button:hover:not(:disabled)": { background: "var(--bg-hover)", color: "var(--text)" },
  ".cm-find button:disabled": { opacity: "0.35", cursor: "default" },
  ".cm-find button[aria-pressed=true]": {
    background: "var(--accent-soft)",
    color: "var(--accent-text)",
    boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--accent) 55%, transparent)",
  },
  ".cm-find button.cm-find-expander": { height: "auto", width: "18px" },
  ".cm-find-expander svg": { transition: "transform 120ms" },
  ".cm-find.is-replacing .cm-find-expander svg": { transform: "rotate(90deg)" },
  ".cm-find-count": {
    minWidth: "72px",
    padding: "0 6px",
    color: "var(--text-2)",
    fontSize: "12px",
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  ".cm-find-count.is-empty": { color: "var(--red)" },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "color-mix(in srgb, var(--orange) 38%, transparent)",
    outline: "1px solid var(--orange)",
  },
  ".cm-findScope": { backgroundColor: "var(--blue-soft)" },
});

/** Keeps matches clear of the panel when they are scrolled to. */
const margins = EditorView.scrollMargins.of((view) => {
  const panel = panels.get(view);
  return panel ? { top: panel.dom.offsetHeight + 12 } : null;
});

export function findWidget(): Extension {
  return [search({ top: true, createPanel: (view) => new FindPanel(view) }), scopeField, margins, theme];
}
