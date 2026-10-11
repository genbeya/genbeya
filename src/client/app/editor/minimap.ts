/**
 * A minimap: the file in miniature at the right edge, in the syntax colours,
 * with the visible part marked. Clicking jumps there; dragging scrolls. Only
 * the lines the map shows are drawn, so large files stay cheap, and editors
 * too narrow to spare the room leave it out.
 */
import { syntaxTree } from "@codemirror/language";
import type { Extension, Text } from "@codemirror/state";
import { EditorView, type PluginValue, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { highlightTree } from "@lezer/highlight";
import { SYNTAX_COLOURS, syntaxColours } from "./syntax";

/** Width of the map in CSS pixels, and of the gap the text leaves for it. */
export const MINIMAP_WIDTH = 80;
/** Pixels per line, per bar (the rest is a gap) and per character. */
const LINE = 3;
const BAR = 2;
const CHAR = 1;
const INSET = 8;
const COLUMNS = Math.floor((MINIMAP_WIDTH - 2 * INSET) / CHAR);
/** Narrower editors keep all their width for the text. */
export const MINIMAP_MIN_EDITOR_WIDTH = 440;

export interface MinimapLayout {
  /** How far the map itself is scrolled, in pixels: long files do not fit. */
  readonly offset: number;
  /** The first line drawn, from 1. */
  readonly first: number;
  readonly sliderTop: number;
  readonly sliderHeight: number;
  /** How far the slider can travel, for dragging. */
  readonly track: number;
}

/**
 * Where the map stands for `lines` lines in `height` pixels, with the editor
 * scrolled `ratio` (0 to 1) of the way and showing lines `visibleFrom` to `visibleTo`.
 */
export function minimapLayout(lines: number, height: number, ratio: number, visibleFrom: number, visibleTo: number): MinimapLayout {
  const content = lines * LINE;
  const offset = Math.max(0, content - height) * ratio;
  const sliderHeight = Math.max(LINE * 4, (visibleTo - visibleFrom + 1) * LINE);
  return {
    offset,
    first: Math.floor(offset / LINE) + 1,
    sliderTop: (visibleFrom - 1) * LINE - offset,
    sliderHeight,
    track: Math.max(1, Math.min(content, height) - sliderHeight),
  };
}

/**
 * The parts of lines `first` to `last` the map draws: each line up to the
 * last column there is room for (a character takes at least one), so long
 * lines of minified code cost no more than short ones.
 */
export function drawnRanges(doc: Text, first: number, last: number): { from: number; to: number }[] {
  const ranges = [];
  for (let number = first; number <= last; number++) {
    const line = doc.line(number);
    ranges.push({ from: line.from, to: line.from + Math.min(line.length, COLUMNS) });
  }
  return ranges;
}

interface Measured {
  readonly shown: boolean;
  readonly top: number;
  readonly right: number;
  readonly height: number;
  readonly scrollable: number;
  readonly layout: MinimapLayout;
  readonly colours: ReadonlyMap<string, string>;
  readonly text: string;
}

class Minimap implements PluginValue {
  private readonly dom = document.createElement("div");
  private readonly canvas = document.createElement("canvas");
  private readonly slider = document.createElement("div");
  private readonly themeObserver = new MutationObserver(() => this.schedule());
  private readonly colourScheme = matchMedia("(prefers-color-scheme: light)");
  private measured: Measured | null = null;
  private drag: { readonly pointer: number; readonly y: number; readonly scroll: number } | null = null;

  constructor(private readonly view: EditorView) {
    this.dom.className = "cm-minimap";
    this.dom.setAttribute("aria-hidden", "true");
    this.slider.className = "cm-minimap-slider";
    this.dom.append(this.canvas, this.slider);
    view.dom.append(this.dom);
    view.scrollDOM.addEventListener("scroll", this.schedule);
    this.dom.addEventListener("pointerdown", this.pointerDown);
    this.dom.addEventListener("pointermove", this.pointerMove);
    this.dom.addEventListener("pointerup", this.pointerUp);
    this.dom.addEventListener("pointercancel", this.pointerUp);
    // Colours come from the theme's tokens.
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    this.colourScheme.addEventListener("change", this.schedule);
    this.schedule();
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || update.geometryChanged || syntaxTree(update.state) !== syntaxTree(update.startState))
      this.schedule();
  }

  destroy() {
    this.dom.remove();
    this.view.scrollDOM.removeEventListener("scroll", this.schedule);
    this.themeObserver.disconnect();
    this.colourScheme.removeEventListener("change", this.schedule);
  }

  private readonly schedule = () =>
    this.view.requestMeasure({ key: this, read: () => this.measure(), write: (measured) => this.draw(measured) });

  private measure(): Measured {
    const { view } = this;
    const scroller = view.scrollDOM;
    const height = scroller.clientHeight;
    const scrollable = scroller.scrollHeight - height;
    // The document's top relative to the top of what is visible.
    const documentTop = view.documentTop - scroller.getBoundingClientRect().top;
    const lineAt = (y: number) => view.state.doc.lineAt(view.lineBlockAtHeight(y - documentTop).from).number;
    const style = getComputedStyle(view.dom);
    const colours = new Map<string, string>();
    // "var(--green)" is resolved to the theme's green.
    for (const colour of SYNTAX_COLOURS) colours.set(colour, style.getPropertyValue(colour.slice(4, -1)).trim());
    return {
      // The theme hides the map in narrow editors.
      shown: this.dom.offsetWidth > 0,
      top: scroller.offsetTop,
      right: scroller.offsetWidth - scroller.clientWidth,
      height,
      scrollable,
      layout: minimapLayout(view.state.doc.lines, height, scrollable > 0 ? scroller.scrollTop / scrollable : 0, lineAt(0), lineAt(height)),
      colours,
      text: style.getPropertyValue("--text-2").trim(),
    };
  }

  private draw(measured: Measured) {
    this.measured = measured;
    const { dom, canvas, slider } = this;
    if (!measured.shown) return;
    const { layout, height } = measured;
    dom.style.top = `${measured.top}px`;
    dom.style.right = `${measured.right}px`;
    dom.style.height = `${height}px`;
    slider.style.top = `${layout.sliderTop}px`;
    slider.style.height = `${layout.sliderHeight}px`;
    const ratio = devicePixelRatio || 1;
    const [width, pixels] = [Math.round(MINIMAP_WIDTH * ratio), Math.round(height * ratio)];
    if (canvas.width !== width || canvas.height !== pixels) [canvas.width, canvas.height] = [width, pixels];
    canvas.style.height = `${height}px`;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, MINIMAP_WIDTH, height);
    this.paint(context, measured);
  }

  /** Draws each run of non-blank characters as a bar in its token's colour, one fill per colour. */
  private paint(context: CanvasRenderingContext2D, { layout, height, colours, text }: Measured) {
    const { state } = this.view;
    const { doc, tabSize } = state;
    const last = Math.min(doc.lines, layout.first + Math.ceil(height / LINE));
    if (layout.first > last) return;
    const tree = syntaxTree(state);
    const spans: { from: number; to: number; colour: string }[] = [];
    for (const range of drawnRanges(doc, layout.first, last))
      highlightTree(
        tree,
        syntaxColours,
        (start, end, classes) => spans.push({ from: start, to: end, colour: colours.get(classes.split(" ")[0]!) ?? text }),
        range.from,
        range.to,
      );
    const bars = new Map<string, Path2D>();
    const bar = (colour: string) => bars.get(colour) ?? bars.set(colour, new Path2D()).get(colour)!;
    let span = 0;
    for (let number = layout.first; number <= last; number++) {
      const line = doc.line(number);
      const y = (number - 1) * LINE - layout.offset;
      let column = 0;
      let runStart = -1;
      let runColour = "";
      const flush = () => {
        if (runStart >= 0) bar(runColour).rect(INSET + runStart * CHAR, y, (column - runStart) * CHAR, BAR);
        runStart = -1;
      };
      for (let index = 0; index < line.length && column < COLUMNS; index++) {
        const code = line.text.charCodeAt(index);
        if (code === 32 || code === 9) {
          flush();
          column = code === 9 ? column + tabSize - (column % tabSize) : column + 1;
          continue;
        }
        const position = line.from + index;
        while (span < spans.length && spans[span]!.to <= position) span++;
        const colour = span < spans.length && spans[span]!.from <= position ? spans[span]!.colour : text;
        if (colour !== runColour) flush();
        if (runStart < 0) [runStart, runColour] = [column, colour];
        column++;
      }
      flush();
    }
    context.globalAlpha = 0.65;
    for (const [colour, path] of bars) {
      context.fillStyle = colour;
      context.fill(path);
    }
  }

  private readonly pointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || !this.measured) return;
    event.preventDefault();
    this.dom.setPointerCapture?.(event.pointerId);
    const scroller = this.view.scrollDOM;
    if (event.target !== this.slider) {
      // A click elsewhere centres the line under it; dragging on carries on from there.
      const { doc } = this.view.state;
      const y = event.clientY - this.dom.getBoundingClientRect().top;
      const line = Math.min(doc.lines, Math.max(1, Math.floor((y + this.measured.layout.offset) / LINE) + 1));
      const documentOffset = this.view.documentTop - scroller.getBoundingClientRect().top + scroller.scrollTop;
      scroller.scrollTop = this.view.lineBlockAt(doc.line(line).from).top + documentOffset - scroller.clientHeight / 2;
    }
    this.drag = { pointer: event.pointerId, y: event.clientY, scroll: scroller.scrollTop };
    this.dom.classList.add("is-dragging");
  };

  private readonly pointerMove = (event: PointerEvent) => {
    const { drag, measured } = this;
    if (!drag || drag.pointer !== event.pointerId || !measured) return;
    this.view.scrollDOM.scrollTop = drag.scroll + ((event.clientY - drag.y) * measured.scrollable) / measured.layout.track;
  };

  private readonly pointerUp = (event: PointerEvent) => {
    if (this.drag?.pointer !== event.pointerId) return;
    this.drag = null;
    this.dom.classList.remove("is-dragging");
  };
}

const theme = EditorView.theme({
  // The text leaves room for the map, unless the editor is too narrow to spare it.
  "&": { containerType: "inline-size" },
  ".cm-content": { paddingRight: `${MINIMAP_WIDTH}px` },
  [`@container (max-width: ${MINIMAP_MIN_EDITOR_WIDTH - 1}px)`]: {
    ".cm-minimap": { display: "none" },
    ".cm-content": { paddingRight: "0" },
  },
  ".cm-minimap": {
    position: "absolute",
    width: `${MINIMAP_WIDTH}px`,
    overflow: "hidden",
    zIndex: "200",
    borderLeft: "1px solid var(--line)",
    background: "var(--bg-panel)",
    cursor: "default",
  },
  ".cm-minimap canvas": { display: "block", width: "100%" },
  ".cm-minimap-slider": {
    position: "absolute",
    left: "0",
    right: "0",
    background: "color-mix(in srgb, var(--text-3) 14%, transparent)",
    transition: "background 120ms",
  },
  ".cm-minimap:hover .cm-minimap-slider": { background: "color-mix(in srgb, var(--text-3) 24%, transparent)" },
  ".cm-minimap.is-dragging .cm-minimap-slider": { background: "color-mix(in srgb, var(--text-3) 34%, transparent)" },
});

const plugin = ViewPlugin.fromClass(Minimap);

/** The minimap, for code; prose has none. */
export function minimap(): Extension {
  return [plugin, theme];
}
