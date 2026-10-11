/**
 * The micromark syntax of math: `$$` blocks and `$$…$$` in text from
 * micromark-extension-math, and `$…$` with Pandoc's rules, which GitHub
 * follows too: the opening `$` is followed by a non-space, the closing one
 * preceded by a non-space and not followed by a digit. So "$5 and $10"
 * stays text. Inside, `\$` is a dollar sign, not the end.
 */
import { math } from "micromark-extension-math";
import { asciiDigit, markdownLineEnding, markdownLineEndingOrSpace } from "micromark-util-character";
import type { Code, Construct, Extension, Previous, State, TokenizeContext, Tokenizer } from "micromark-util-types";

const DOLLAR = 36;
const BACKSLASH = 92;
const BACKTICK = 96;

/** A `$` that ends math: not followed by a digit. Checked only, never kept. */
const closingDollar: Construct = {
  partial: true,
  tokenize(effects, ok, nok) {
    return (code) => {
      effects.enter("mathTextSequence");
      effects.consume(code);
      effects.exit("mathTextSequence");
      return (next: Code) => (asciiDigit(next) ? nok(next) : ok(next));
    };
  },
};

const tokenizeDollarMath: Tokenizer = function (effects, ok, nok) {
  let previous: Code = null;
  let inData = false;

  const data = (code: Code) => {
    if (!inData) effects.enter("mathTextData");
    inData = true;
    effects.consume(code);
  };
  const endData = () => {
    if (inData) effects.exit("mathTextData");
    inData = false;
  };

  const start: State = (code) => {
    effects.enter("mathText");
    effects.enter("mathTextSequence");
    effects.consume(code);
    effects.exit("mathTextSequence");
    return open;
  };

  // `$$` belongs to micromark-extension-math, and `` $`…`$ `` is GitHub's form around a code span.
  const open: State = (code) =>
    code === null || code === DOLLAR || code === BACKTICK || markdownLineEndingOrSpace(code) ? nok(code) : inside(code);

  const inside: State = (code) => {
    if (code === null) return nok(code);
    if (markdownLineEnding(code)) {
      endData();
      effects.enter("lineEnding");
      effects.consume(code);
      effects.exit("lineEnding");
      previous = code;
      return inside;
    }
    if (code === DOLLAR && !markdownLineEndingOrSpace(previous)) return effects.check(closingDollar, close, content)(code);
    return content(code);
  };

  const content: State = (code) => {
    data(code);
    previous = code;
    return code === BACKSLASH ? escaped : inside;
  };

  const escaped: State = (code) => {
    if (code === null || markdownLineEnding(code)) return inside(code);
    data(code);
    previous = code;
    return inside;
  };

  const close: State = (code) => {
    endData();
    effects.enter("mathTextSequence");
    effects.consume(code);
    effects.exit("mathTextSequence");
    effects.exit("mathText");
    return ok;
  };

  return start;
};

/** Not right after another `$`, unless that one was escaped. */
const previous: Previous = function (this: TokenizeContext, code) {
  return code !== DOLLAR || this.events.at(-1)?.[1].type === "characterEscape";
};

const dollarMath: Construct = { name: "mathText", tokenize: tokenizeDollarMath, previous };

export function mathSyntax(): Extension[] {
  return [math({ singleDollarTextMath: false }), { text: { [DOLLAR]: dollarMath } }];
}
