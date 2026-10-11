import { CompletionContext, type Completion, type CompletionResult } from "@codemirror/autocomplete";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { Person } from "../../../contracts/model";
import { dateSource, markdownBlockSource, markdownReferenceSource, mentionSource } from "./markdown-completion";

const people: Person[] = [
  { handle: "ada", name: "Ada Lovelace", email: "ada@example.com", aliases: [], commits: 2 },
  { handle: "grace", name: "Grace Hopper", email: null, aliases: [], commits: 1 },
];
/** A Sunday. */
const TODAY = "2026-10-11";

type Source = (context: CompletionContext) => CompletionResult | null;

/** An editor holding `doc`, with the cursor at `|`, and what `source` offers there. */
function complete(doc: string, source: Source) {
  const at = doc.indexOf("|");
  const view = new EditorView({
    state: EditorState.create({ doc: doc.replace("|", ""), selection: { anchor: at }, extensions: [markdown()] }),
  });
  const result = source(new CompletionContext(view.state, at, false));
  const apply = (label: string) => {
    const option = result!.options.find((candidate) => candidate.label === label)! as Completion & {
      apply: (view: EditorView, completion: Completion, from: number, to: number) => void;
    };
    option.apply(view, option, result!.from, view.state.selection.main.head);
    return view.state.sliceDoc();
  };
  onTestFinished(() => view.destroy());
  return { result, apply, view };
}

const mentions = mentionSource(() => people);
const dates = dateSource(() => TODAY);

describe("mention completion", () => {
  it("offers people after @ by name, handle or email, and inserts the handle", () => {
    const { result, apply } = complete("Ask @gr| today", mentions);
    expect(result?.from).toBe(4);
    expect(result?.options.map((option) => [option.label, option.detail])).toEqual([["Grace Hopper", "@grace"]]);
    expect(apply("Grace Hopper")).toBe("Ask @grace today");
    expect(complete("Ask @|", mentions).apply("Ada Lovelace")).toBe("Ask @ada ");
  });

  it("stays quiet in emails, code and when nobody matches", () => {
    expect(complete("mail ada@ex|", mentions).result).toBeNull();
    expect(complete("Run `@ad|`", mentions).result).toBeNull();
    expect(complete("```\n@ad|\n```", mentions).result).toBeNull();
    expect(complete("Ask @zzz|", mentions).result).toBeNull();
  });
});

describe("date completion", () => {
  it("offers dates after // and inserts the ISO date", () => {
    const { result, apply } = complete("Due //tom|", dates);
    expect(result?.from).toBe(4);
    expect(result?.options.map((option) => option.label)).toEqual(["Tomorrow", "Pick a date…"]);
    expect(apply("Tomorrow")).toBe("Due 2026-10-12");
    expect(complete("- [ ] Ship //fri|", dates).apply("Friday")).toBe("- [ ] Ship 2026-10-16");
  });

  it("stays quiet in URLs and code", () => {
    expect(complete("See https://|", dates).result).toBeNull();
    expect(complete("```js\n//tom|\n```", dates).result).toBeNull();
  });

  it("picks a date from the calendar with the keyboard", () => {
    const { apply, view } = complete("Due //|", dates);
    expect(apply("Pick a date…")).toBe("Due //");
    const grid = document.querySelector<HTMLElement>(".date-picker [role='grid']")!;
    expect(grid.getAttribute("aria-activedescendant")).toMatch(/2026-10-11$/);
    for (const key of ["ArrowRight", "ArrowDown", "Enter"]) grid.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    expect(view.state.sliceDoc()).toBe("Due 2026-10-19");
    expect(document.querySelector(".date-picker")).toBeNull();
  });

  it("gives up on the calendar with Escape, leaving the text", () => {
    const { apply, view } = complete("Due //|", dates);
    apply("Pick a date…");
    document.querySelector(".date-picker [role='grid']")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".date-picker")).toBeNull();
    expect(view.state.sliceDoc()).toBe("Due //");
  });
});

describe("blocks and dates", () => {
  it("offers blocks after / alone at the start of a line, and dates after //", () => {
    expect(complete("/|", markdownBlockSource).result?.options.map((option) => option.label)).toContain("Math");
    expect(complete("/|", dates).result).toBeNull();
    expect(complete("//|", markdownBlockSource).result).toBeNull();
    expect(complete("//|", dates).result?.options.map((option) => option.label)).toContain("Today");
    expect(complete("Due //|", markdownBlockSource).result).toBeNull();
  });

  it("offers no blocks inside code blocks or math", () => {
    expect(complete("```sh\n/|\n```", markdownBlockSource).result).toBeNull();
    expect(complete("$$\n/|\n$$", markdownBlockSource).result).toBeNull();
  });

  it("offers no mentions or dates inside math", () => {
    expect(complete("$a @ad|$", mentions).result).toBeNull();
    expect(complete("$$\nx //|\n$$", dates).result).toBeNull();
    expect(complete("$a$ and @ad|", mentions).result).not.toBeNull();
  });
});

describe("reference completion", () => {
  const references = markdownReferenceSource(() => [{ kind: "page", label: "Guide", detail: "docs/Guide.md", target: "Guide" }]);

  it("offers references after [[, but not in code or math", () => {
    expect(complete("See [[Gu|", references).result?.options.map((option) => option.label)).toEqual(["Guide"]);
    expect(complete("See `[[Gu|`", references).result).toBeNull();
    expect(complete("```\n[[Gu|\n```", references).result).toBeNull();
    expect(complete("$[[Gu|$", references).result).toBeNull();
  });
});
