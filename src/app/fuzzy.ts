/** Substring matches rank above scattered (subsequence) matches; earlier is better. */
export function score(text: string, query: string) {
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  const at = t.indexOf(q);
  if (at >= 0) return 1000 - at * 2 - (t.length - q.length) * 0.1 + (at === 0 || /[\s/_-]/.test(t[at - 1]) ? 50 : 0);
  let i = 0;
  let gaps = 0;
  for (const c of t) {
    if (c === q[i]) i++;
    else if (i > 0) gaps++;
    if (i === q.length) return 400 - gaps;
  }
  return -1;
}
