/** The initials and colour of a person's avatar, without Angular, so rendered Markdown can use them anywhere. */

/** How many avatar colours the tokens define (`--avatar-0` …). */
const HUES = 8;

/** "Ada Lovelace" → "AL", "sam" → "S". */
export const initials = (name: string): string =>
  name
    .split(/[\s._@-]+/)
    .filter(Boolean)
    .map((word) => word[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";

/** The colour of a name's avatar, 0 to 7, the same wherever the person shows. */
export function avatarHue(name: string): number {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return Math.abs(hash) % HUES;
}
