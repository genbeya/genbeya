/**
 * How well `query` matches `text`: substring matches rank above scattered
 * (subsequence) ones, earlier and word-start matches higher; -1 is no match.
 */
export function fuzzyScore(text: string, query: string): number {
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  const at = haystack.indexOf(needle);
  if (at >= 0) return 1000 - at * 2 - (haystack.length - needle.length) * 0.1 + (at === 0 || /[\s/_-]/.test(haystack[at - 1]!) ? 50 : 0);
  let matched = 0;
  let gaps = 0;
  for (const character of haystack) {
    if (character === needle[matched]) matched++;
    else if (matched > 0) gaps++;
    if (matched === needle.length) return 400 - gaps;
  }
  return -1;
}
