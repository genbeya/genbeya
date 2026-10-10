/** Syntax colours, matching the Markdown code highlighting. The minimap paints with the same ones. */
import { HighlightStyle, type TagStyle } from "@codemirror/language";
import { tagHighlighter, tags } from "@lezer/highlight";

const STYLES: readonly TagStyle[] = [
  { tag: [tags.keyword, tags.operatorKeyword, tags.modifier, tags.controlKeyword], color: "var(--purple)" },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "var(--green)" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "var(--orange)" },
  { tag: [tags.comment, tags.meta], color: "var(--text-3)", fontStyle: "italic" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "var(--blue)" },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "var(--yellow)" },
  { tag: [tags.tagName, tags.heading], color: "var(--accent-text)", fontWeight: "600" },
  { tag: [tags.attributeName, tags.propertyName], color: "var(--text-2)" },
  { tag: tags.link, color: "var(--accent-text)", textDecoration: "underline" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.invalid, color: "var(--red)" },
];

export const highlight = HighlightStyle.define([...STYLES]);

const coloured = STYLES.filter((style) => typeof style["color"] === "string").map((style) => ({
  tag: style.tag,
  class: style["color"] as string,
}));

/** Names each token's colour (a CSS value such as `var(--green)`) where a highlighter would name a class. */
export const syntaxColours = tagHighlighter(coloured);

/** Every colour `syntaxColours` names. */
export const SYNTAX_COLOURS: readonly string[] = [...new Set(coloured.map((style) => style.class))];
