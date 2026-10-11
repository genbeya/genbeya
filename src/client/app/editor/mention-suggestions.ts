/** What `@` offers while writing Markdown: the repository's people, found by handle, name or email. */
import type { Person } from "../../../contracts/model";

/** `@` and what follows it at the end of the text before the cursor; not inside a word or an email. */
export const MENTION_TRIGGER = /(?<![\p{L}\p{N}_@./\\:+-])@([\p{L}\p{N}_.-]*)$/u;

/** At most this many people are listed. */
const LIMIT = 30;

/** How well `query` finds `person`: lower is better, null for not at all. */
function rank(person: Person, query: string): number | null {
  if (!query) return 3;
  const handle = person.handle.toLowerCase();
  const words = person.name.toLowerCase().split(/\s+/);
  const email = (person.email ?? "").toLowerCase();
  if (handle.startsWith(query)) return 0;
  if (person.name.toLowerCase().startsWith(query) || words.some((word) => word.startsWith(query))) return 1;
  if (email.startsWith(query) || person.aliases.some((alias) => alias.toLowerCase().startsWith(query))) return 2;
  return handle.includes(query) || person.name.toLowerCase().includes(query) || email.includes(query) ? 3 : null;
}

/** The people `query` finds, best first; people with more commits first among equals. */
export function mentionSuggestions(people: readonly Person[], query: string): Person[] {
  const text = query.trim().toLowerCase();
  return people
    .map((person) => ({ person, rank: rank(person, text) }))
    .filter((entry): entry is { person: Person; rank: number } => entry.rank !== null)
    .sort((a, b) => a.rank - b.rank || b.person.commits - a.person.commits || a.person.name.localeCompare(b.person.name))
    .slice(0, LIMIT)
    .map((entry) => entry.person);
}

/** What picking `person` inserts: the mention, and a space unless one follows. */
export const mentionText = (person: Person, next: string): string => `@${person.handle}${/^\s/.test(next) ? "" : " "}`;
