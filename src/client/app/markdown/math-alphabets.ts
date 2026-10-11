/**
 * Letters in the styles of `mathvariant` as Unicode's mathematical
 * alphanumeric symbols. MathML Core, which Chromium implements, ignores
 * `mathvariant` other than `normal`, so 𝐱, ℝ and 𝔤 have to be characters.
 */

interface Alphabet {
  readonly upper: number;
  readonly lower: number;
  readonly digits?: number;
  readonly greekUpper?: number;
  readonly greekLower?: number;
  /** Letters Unicode encoded before this block, elsewhere. */
  readonly holes?: Readonly<Record<string, number>>;
}

const ALPHABETS: Readonly<Record<string, Alphabet>> = {
  bold: { upper: 0x1d400, lower: 0x1d41a, digits: 0x1d7ce, greekUpper: 0x1d6a8, greekLower: 0x1d6c2 },
  italic: { upper: 0x1d434, lower: 0x1d44e, greekUpper: 0x1d6e2, greekLower: 0x1d6fc, holes: { h: 0x210e } },
  "bold-italic": { upper: 0x1d468, lower: 0x1d482, greekUpper: 0x1d71c, greekLower: 0x1d736 },
  script: {
    upper: 0x1d49c,
    lower: 0x1d4b6,
    holes: { B: 0x212c, E: 0x2130, F: 0x2131, H: 0x210b, I: 0x2110, L: 0x2112, M: 0x2133, R: 0x211b, e: 0x212f, g: 0x210a, o: 0x2134 },
  },
  "bold-script": { upper: 0x1d4d0, lower: 0x1d4ea },
  fraktur: { upper: 0x1d504, lower: 0x1d51e, holes: { C: 0x212d, H: 0x210c, I: 0x2111, R: 0x211c, Z: 0x2128 } },
  "double-struck": {
    upper: 0x1d538,
    lower: 0x1d552,
    digits: 0x1d7d8,
    holes: { C: 0x2102, H: 0x210d, N: 0x2115, P: 0x2119, Q: 0x211a, R: 0x211d, Z: 0x2124 },
  },
  "bold-fraktur": { upper: 0x1d56c, lower: 0x1d586 },
  "sans-serif": { upper: 0x1d5a0, lower: 0x1d5ba, digits: 0x1d7e2 },
  "bold-sans-serif": { upper: 0x1d5d4, lower: 0x1d5ee, digits: 0x1d7ec, greekUpper: 0x1d756, greekLower: 0x1d770 },
  "sans-serif-italic": { upper: 0x1d608, lower: 0x1d622 },
  "sans-serif-bold-italic": { upper: 0x1d63c, lower: 0x1d656, greekUpper: 0x1d790, greekLower: 0x1d7aa },
  monospace: { upper: 0x1d670, lower: 0x1d68a, digits: 0x1d7f6 },
};

const within = (code: number, from: number, to: number) => code >= from && code <= to;

function styled(character: string, alphabet: Alphabet): string {
  const hole = alphabet.holes?.[character];
  if (hole) return String.fromCodePoint(hole);
  const code = character.codePointAt(0)!;
  let mapped: number | undefined;
  if (within(code, 0x41, 0x5a)) mapped = alphabet.upper + code - 0x41;
  else if (within(code, 0x61, 0x7a)) mapped = alphabet.lower + code - 0x61;
  else if (within(code, 0x30, 0x39) && alphabet.digits) mapped = alphabet.digits + code - 0x30;
  // Α–Ω and α–ω; the gap at U+03A2 holds ϴ in the mathematical alphabets.
  else if (within(code, 0x391, 0x3a9) && alphabet.greekUpper) mapped = alphabet.greekUpper + code - 0x391;
  else if (within(code, 0x3b1, 0x3c9) && alphabet.greekLower) mapped = alphabet.greekLower + code - 0x3b1;
  return mapped === undefined ? character : String.fromCodePoint(mapped);
}

/** `text` in the style `variant`; null when the variant has no alphabet (`normal`, unknown ones). */
export function styledText(text: string, variant: string): string | null {
  const alphabet = ALPHABETS[variant];
  return alphabet ? Array.from(text, (character) => styled(character, alphabet)).join("") : null;
}
