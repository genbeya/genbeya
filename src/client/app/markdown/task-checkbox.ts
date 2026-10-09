/** Flips the first task-list checkbox (`[ ]` or `[x]`) at or after `offset` in Markdown source. */
export function toggleCheckboxAt(source: string, offset: number): string {
  const match = /\[( |x|X)\]/.exec(source.slice(offset));
  if (!match) return source;
  const at = offset + match.index + 1;
  return source.slice(0, at) + (match[1] === " " ? "x" : " ") + source.slice(at + 1);
}
