/**
 * The repository's people, merged from what names them: the people the
 * settings list, recent commit authors, comment authors and assignees.
 * Everyone gets a unique handle for `@mentions`.
 */
import type { Person, PersonEntry } from "../contracts/model";
import { findPerson, handleSlug, peopleIndex } from "../utilities/people";

/** Commits by one name and email, as `git log --format=%aN%x00%aE` prints them (with .mailmap applied). */
export interface CommitAuthor {
  readonly name: string;
  readonly email: string;
  readonly commits: number;
}

export interface PeopleSources {
  /** From the settings; they win. */
  readonly configured: readonly PersonEntry[];
  readonly authors: readonly CommitAuthor[];
  /** Task assignees as the tasks write them: a handle, a name or an email. */
  readonly assignees: readonly string[];
  /** Comment authors' names. */
  readonly commenters: readonly string[];
}

/** Email local parts that name a mailbox rather than a person. */
const GENERIC_MAILBOXES = new Set(["noreply", "no-reply", "root"]);

interface Draft {
  handle: string | null;
  name: string;
  email: string | null;
  readonly aliases: string[];
  commits: number;
}

const key = (text: string) => text.trim().toLowerCase();

/** "ada@example.com" → "ada"; GitHub's "123+ada@users.noreply.github.com" → "ada"; "ada+git@…" → "ada". */
function mailbox(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  const name = domain.toLowerCase() === "users.noreply.github.com" ? local.slice(local.indexOf("+") + 1) : local.split("+")[0]!;
  return GENERIC_MAILBOXES.has(name.toLowerCase()) ? "" : name;
}

export class PeopleEngine {
  merge(sources: PeopleSources): Person[] {
    const drafts: Draft[] = [];
    /** Who each name, email, alias and handle means, lower case. */
    const owners = new Map<string, Draft>();
    const claim = (draft: Draft, text: string) => {
      if (key(text) && !owners.has(key(text))) owners.set(key(text), draft);
    };
    /** Adds another name or email of `draft`, unless it is the one shown or known already. */
    const alias = (draft: Draft, text: string) => {
      const known = [draft.name, draft.email ?? "", ...draft.aliases].some((other) => key(other) === key(text));
      if (key(text) && !known) draft.aliases.push(text.trim());
      claim(draft, text);
    };
    const create = (name: string, email: string | null, handle: string | null = null): Draft => {
      const draft: Draft = { handle, name: name.trim(), email: email?.trim() || null, aliases: [], commits: 0 };
      drafts.push(draft);
      for (const text of [handle ?? "", draft.name, draft.email ?? ""]) claim(draft, text);
      return draft;
    };

    for (const entry of sources.configured) {
      const draft = create(entry.name, entry.email ?? null, entry.handle);
      for (const text of entry.aliases ?? []) alias(draft, text);
    }

    // One author per email, named as most commits name them; the busiest come first, so they keep their name and email.
    const byEmail = new Map<string, CommitAuthor[]>();
    for (const author of sources.authors) {
      const id = key(author.email) || `name:${key(author.name)}`;
      byEmail.set(id, [...(byEmail.get(id) ?? []), author]);
    }
    const groups = [...byEmail.values()]
      .map((names) => [...names].sort((a, b) => b.commits - a.commits))
      .map((names) => ({ names, commits: names.reduce((sum, author) => sum + author.commits, 0) }))
      .sort((a, b) => b.commits - a.commits || key(a.names[0]!.email).localeCompare(key(b.names[0]!.email)));
    for (const { names, commits } of groups) {
      const [top] = names;
      const email = top!.email.trim();
      const draft =
        (email ? owners.get(key(email)) : undefined) ??
        names.map((author) => owners.get(key(author.name))).find(Boolean) ??
        create(top!.name, email || null);
      if (!draft.email && email) draft.email = email;
      draft.commits += commits;
      for (const author of names) alias(draft, author.name);
      alias(draft, email);
    }

    for (const name of sources.commenters) if (key(name) && !owners.has(key(name))) create(name, null);

    const taken = new Set(drafts.flatMap((draft) => (draft.handle ? [key(draft.handle)] : [])));
    const assignHandles = () => {
      // In a fixed order, so the same people always get the same handles.
      const pending = drafts.filter((draft) => !draft.handle).sort((a, b) => key(a.email ?? a.name).localeCompare(key(b.email ?? b.name)));
      for (const draft of pending) {
        const first = draft.name.split(/\s+/)[0] ?? "";
        const slugs = [mailbox(draft.email ?? ""), draft.name, first].map(handleSlug).filter(Boolean);
        const candidates = slugs.length ? slugs : ["person"];
        let handle = candidates.find((candidate) => !taken.has(candidate));
        if (!handle) {
          const base = candidates[0]!;
          let number = 2;
          while (taken.has(`${base}-${number}`)) number++;
          handle = `${base}-${number}`;
        }
        draft.handle = handle;
        taken.add(handle);
        claim(draft, handle);
      }
    };
    assignHandles();

    // Assignees may be written as a handle, a name or an email.
    for (const assignee of sources.assignees) if (key(assignee) && !owners.has(key(assignee))) create(assignee, null);
    assignHandles();

    return drafts
      .map(({ handle, name, email, aliases, commits }): Person => ({ handle: handle!, name, email, aliases, commits }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.handle.localeCompare(b.handle));
  }

  /** The handle of the user Git knows as `identity`, by email, else by name; null when they are none of `people`. */
  me(people: readonly Person[], identity: { readonly name: string; readonly email: string } | null): string | null {
    if (!identity) return null;
    const index = peopleIndex(people);
    return (findPerson(index, identity.email) ?? findPerson(index, identity.name))?.handle ?? null;
  }
}
