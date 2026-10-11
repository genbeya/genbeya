import { describe, expect, it } from "vitest";
import type { Person } from "../contracts/model";
import { findPerson, handleSlug, HANDLE, MENTION, mentioned, peopleIndex } from "./people";

const ada: Person = { handle: "ada", name: "Ada Lovelace", email: "ada@example.com", aliases: ["Countess", "lovelace"], commits: 3 };
const bob: Person = { handle: "bob-builder", name: "Bob", email: null, aliases: [], commits: 0 };
const index = peopleIndex([ada, bob]);

const mentions = (text: string) => [...text.matchAll(MENTION)].map((match) => match[1]);

describe("handles", () => {
  it("are letters, digits, - and _, starting and ending with a letter or digit", () => {
    for (const handle of ["ada", "Ada-L", "a_b", "x1", "a"]) expect(HANDLE.test(handle)).toBe(true);
    for (const handle of ["-ada", "ada-", "a.b", "a b", "", "a".repeat(40)]) expect(HANDLE.test(handle)).toBe(false);
  });

  it("are derived from names and email local parts as slugs", () => {
    expect(handleSlug("Ada Lovelace")).toBe("ada-lovelace");
    expect(handleSlug("Zoë.O'Brien")).toBe("zoe-o-brien");
    expect(handleSlug("  --  ")).toBe("");
    expect(handleSlug("x".repeat(50))).toHaveLength(39);
  });
});

describe("MENTION", () => {
  it("finds @handles in text", () => {
    expect(mentions("@ada, ask @bob-builder (or @x1).")).toEqual(["ada", "bob-builder", "x1"]);
    expect(mentions("Thanks @ada.")).toEqual(["ada"]);
    expect(mentions("Thanks @ada-")).toEqual(["ada"]);
  });

  it("leaves out emails, paths and words with @ inside", () => {
    expect(mentions("ada@example.com a@b x/@ada c:@ada a.@b")).toEqual([]);
    expect(mentions("@ada.lovelace @ada@example.com @ada_")).toEqual([]);
    expect(mentions("@ @-ada")).toEqual([]);
  });
});

describe("findPerson", () => {
  it("finds people by handle, name, email or alias, ignoring case", () => {
    for (const text of ["ada", "@ADA", "ada lovelace", "ADA@example.com", "countess", " Ada "]) expect(findPerson(index, text)).toBe(ada);
    expect(findPerson(index, "Bob")).toBe(bob);
    expect(findPerson(index, "carol")).toBeUndefined();
    expect(findPerson(index, "")).toBeUndefined();
  });

  it("finds a mention by handle, or by an alias shaped like one", () => {
    expect(mentioned(index, "Ada")).toBe(ada);
    expect(mentioned(index, "lovelace")).toBe(ada);
    expect(mentioned(index, "bob")).toBeUndefined();
  });
});
