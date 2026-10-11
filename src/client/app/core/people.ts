/**
 * The open repository's people, for `@mentions`, assignees and the
 * editors' completion. Read again whenever what names them changes: a new
 * commit, the settings, assignees or comment authors.
 */
import { computed, effect, inject, Injectable, signal, untracked } from "@angular/core";
import type { People as PeopleList, Person } from "../../../contracts/model";
import { findPerson, peopleIndex } from "../../../utilities/people";
import { sameJson } from "./signals";
import { Session } from "./session";
import { WorkspaceApi } from "./workspace-api";

const NOBODY: PeopleList = { people: [], me: null };

@Injectable({ providedIn: "root" })
export class People {
  private readonly session = inject(Session);
  private readonly api = inject(WorkspaceApi);
  private readonly loaded = signal<PeopleList>(NOBODY);
  private request = 0;

  readonly list = computed(() => this.loaded().people);
  /** The user, if Git's identity is among the people. */
  readonly me = computed(() => this.list().find((person) => person.handle === this.loaded().me) ?? null);
  private readonly index = computed(() => peopleIndex(this.list()));

  /** What the people are made of; the HEAD commit stands for the commit authors. */
  private readonly sources = computed(
    () => {
      const snapshot = this.session.snapshot();
      if (!snapshot) return null;
      return {
        id: this.session.id(),
        commit: snapshot.head.commit,
        settings: snapshot.settingsHash,
        tasks: snapshot.tasks.map((task) => [task.assignee, ...task.comments.map((comment) => comment.author)]),
      };
    },
    { equal: sameJson },
  );

  constructor() {
    effect(() => {
      const sources = this.sources();
      untracked(() => (sources ? void this.load() : this.loaded.set(NOBODY)));
    });
  }

  /** The person `text` names (a handle, name, email or alias), if any. */
  find(text: string): Person | undefined {
    return findPerson(this.index(), text);
  }

  /** Who `text` is: the handle of the person it names, else the text itself. */
  readonly identify = (text: string): string => this.find(text)?.handle ?? text;

  /** How to show `text` as a person: their name, else the text itself. */
  readonly nameOf = (text: string): string => this.find(text)?.name ?? text;

  private async load() {
    const ticket = ++this.request;
    try {
      const people = await this.api.content.people();
      if (ticket === this.request) this.loaded.set(people);
    } catch {
      // Mentions then stay text, and the assignee menu lists the tasks' assignees.
    }
  }
}
