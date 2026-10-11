import { describe, expect, it } from "vitest";
import type { Person } from "../contracts/model";
import { PeopleEngine, type PeopleSources } from "./people-engine";

const engine = new PeopleEngine();
const NONE: PeopleSources = { configured: [], authors: [], assignees: [], commenters: [] };
const merge = (sources: Partial<PeopleSources>) => engine.merge({ ...NONE, ...sources });
const handles = (people: readonly Person[]) => Object.fromEntries(people.map((person) => [person.name, person.handle]));

describe("PeopleEngine", () => {
  it("takes commit authors once per email, with the name they use most", () => {
    const people = merge({
      authors: [
        { name: "Test", email: "Ada@Example.com", commits: 2 },
        { name: "Ada Lovelace", email: "ada@example.com", commits: 9 },
        { name: "Bob", email: "bob@example.com", commits: 1 },
      ],
    });
    expect(people).toEqual([
      { handle: "ada", name: "Ada Lovelace", email: "ada@example.com", aliases: ["Test"], commits: 11 },
      { handle: "bob", name: "Bob", email: "bob@example.com", aliases: [], commits: 1 },
    ]);
  });

  it("joins authors with the same name and several emails", () => {
    const [ada, ...others] = merge({
      authors: [
        { name: "Ada Lovelace", email: "ada@home.example", commits: 1 },
        { name: "ada lovelace", email: "ada@work.example", commits: 5 },
      ],
    });
    expect(others).toEqual([]);
    expect(ada).toEqual({ handle: "ada", name: "ada lovelace", email: "ada@work.example", aliases: ["ada@home.example"], commits: 6 });
  });

  it("adds comment authors and assignees that are no one else", () => {
    const people = merge({
      authors: [{ name: "Ada Lovelace", email: "ada@example.com", commits: 1 }],
      commenters: ["Ada Lovelace", "Carol Danvers", "carol danvers"],
      assignees: ["ada", "ADA@example.com", "sam", "Carol Danvers", ""],
    });
    expect(people.map(({ name, handle, email }) => [name, handle, email])).toEqual([
      ["Ada Lovelace", "ada", "ada@example.com"],
      ["Carol Danvers", "carol-danvers", null],
      ["sam", "sam", null],
    ]);
  });

  describe("handles", () => {
    it("come from the email's local part, else the name", () => {
      expect(
        handles(
          merge({
            authors: [
              { name: "Emanuel Knecht", email: "emanuel.knecht@proton.me", commits: 1 },
              { name: "Octo Cat", email: "12345+OctoCat@users.noreply.github.com", commits: 1 },
              { name: "Bot", email: "noreply@example.com", commits: 1 },
              { name: "Zoë", email: "", commits: 1 },
            ],
          }),
        ),
      ).toEqual({ "Emanuel Knecht": "emanuel-knecht", "Octo Cat": "octocat", Bot: "bot", Zoë: "zoe" });
    });

    it("are unique: the first by email or name takes a handle, the next one tries the name, then a number", () => {
      expect(
        handles(
          merge({
            authors: [
              { name: "Alex Smith", email: "alex@b.example", commits: 1 },
              { name: "Alex Jones", email: "alex@a.example", commits: 5 },
              { name: "Alex Smith 2", email: "alex@c.example", commits: 1 },
              { name: "Alex", email: "alex@d.example", commits: 1 },
            ],
          }),
        ),
      ).toEqual({ "Alex Jones": "alex", "Alex Smith": "alex-smith", "Alex Smith 2": "alex-smith-2", Alex: "alex-2" });
    });

    it("are the same whatever order the sources list people in", () => {
      const authors = [
        { name: "Sam One", email: "sam@one.example", commits: 1 },
        { name: "Sam Two", email: "sam@two.example", commits: 1 },
      ];
      expect(merge({ authors })).toEqual(merge({ authors: [...authors].reverse() }));
    });

    it("fall back to `person` when neither email nor name has letters or digits", () => {
      expect(merge({ commenters: ["???", "!!!"] }).map((person) => person.handle)).toEqual(["person", "person-2"]);
    });
  });

  describe("the people of the settings", () => {
    it("win: their handle, name and email, matching commits by email or alias", () => {
      const people = merge({
        configured: [
          { handle: "Countess", name: "Ada King", email: "ada@example.com", aliases: ["Ada Lovelace", "lovelace@old.example"] },
          { handle: "ada", name: "Another Ada" },
        ],
        authors: [
          { name: "Ada Lovelace", email: "ada@example.com", commits: 3 },
          { name: "Lovelace", email: "lovelace@old.example", commits: 2 },
          { name: "Ada Smith", email: "ada@smith.example", commits: 1 },
        ],
        assignees: ["Ada Lovelace", "another ada"],
      });
      expect(people).toEqual([
        {
          handle: "Countess",
          name: "Ada King",
          email: "ada@example.com",
          aliases: ["Ada Lovelace", "lovelace@old.example", "Lovelace"],
          commits: 5,
        },
        { handle: "ada-smith", name: "Ada Smith", email: "ada@smith.example", aliases: [], commits: 1 },
        { handle: "ada", name: "Another Ada", email: null, aliases: [], commits: 0 },
      ]);
    });
  });

  it("finds the user among the people by email, else by name", () => {
    const people = merge({
      authors: [
        { name: "Ada Lovelace", email: "ada@example.com", commits: 1 },
        { name: "Bob", email: "bob@example.com", commits: 1 },
      ],
    });
    expect(engine.me(people, { name: "Someone", email: "BOB@example.com" })).toBe("bob");
    expect(engine.me(people, { name: "ada lovelace", email: "" })).toBe("ada");
    expect(engine.me(people, { name: "Carol", email: "carol@example.com" })).toBeNull();
    expect(engine.me(people, null)).toBeNull();
  });
});
