/**
 * Handles and `@mentions`: the rules shared by the people engine, which
 * gives everyone a handle, and the client, which renders mentions of them.
 */
import type { Person } from "../contracts/model";

/** Letters, digits, `-` and `_`, starting and ending with a letter or digit; at most 39 characters, as on GitHub. */
export const HANDLE = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,37}[A-Za-z0-9])?$/;
const HANDLE_LENGTH = 39;

/**
 * `@handle` in text. Not inside a word, an email (`ada@example.com`) or a
 * path (`/@ada`), and not followed by more of one (`@ada.lovelace`,
 * `@ada@example.com`); a full stop or dash ending a sentence is no part of it.
 */
export const MENTION = /(?<![\p{L}\p{N}_@./\\:+-])@([A-Za-z0-9](?:[A-Za-z0-9_-]*[A-Za-z0-9])?)(?![\p{L}\p{N}_@]|[.-][\p{L}\p{N}])/gu;

/** "Ada Lovelace" → "ada-lovelace", "Zoë.O'Brien" → "zoe-o-brien": a valid handle, or "" when nothing is left. */
export function handleSlug(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, HANDLE_LENGTH)
    .replace(/^-+|-+$/g, "");
}

/** Lookups of people by handle, and by any name, email or alias that means them; build once per list. */
export interface PeopleIndex {
  readonly people: readonly Person[];
  readonly byHandle: ReadonlyMap<string, Person>;
  /** Names, emails and aliases. */
  readonly byKey: ReadonlyMap<string, Person>;
  readonly byAlias: ReadonlyMap<string, Person>;
}

const key = (text: string) => text.trim().toLowerCase();

export function peopleIndex(people: readonly Person[]): PeopleIndex {
  const byHandle = new Map<string, Person>();
  const byKey = new Map<string, Person>();
  const byAlias = new Map<string, Person>();
  const add = (map: Map<string, Person>, name: string, person: Person) => {
    if (key(name) && !map.has(key(name))) map.set(key(name), person);
  };
  for (const person of people) {
    byHandle.set(key(person.handle), person);
    for (const name of [person.name, person.email ?? "", ...person.aliases]) add(byKey, name, person);
    for (const alias of person.aliases) add(byAlias, alias, person);
  }
  return { people, byHandle, byKey, byAlias };
}

/** The person `text` names: a handle (with or without `@`), a name, an email or an alias, ignoring case. */
export function findPerson(index: PeopleIndex, text: string): Person | undefined {
  const name = key(text);
  if (!name) return undefined;
  return index.byHandle.get(name.replace(/^@/, "")) ?? index.byKey.get(name);
}

/** The person an `@mention` means: by handle, or by an alias that is shaped like one. */
export function mentioned(index: PeopleIndex, handle: string): Person | undefined {
  const name = key(handle);
  return index.byHandle.get(name) ?? (HANDLE.test(handle) ? index.byAlias.get(name) : undefined);
}
