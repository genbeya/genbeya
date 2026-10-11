import type { Person } from "../../../contracts/model";
import { MENTION_TRIGGER, mentionSuggestions, mentionText } from "./mention-suggestions";

const person = (handle: string, name: string, email: string | null, commits = 0, aliases: string[] = []): Person => ({
  handle,
  name,
  email,
  aliases,
  commits,
});
const ada = person("ada", "Ada Lovelace", "ada@example.com", 5, ["Countess"]);
const alan = person("turing", "Alan Turing", "alan@example.com", 9);
const grace = person("grace", "Grace Hopper", "admiral@navy.example", 1);
const people = [ada, alan, grace];
const handles = (query: string) => mentionSuggestions(people, query).map((found) => found.handle);

describe("mentionSuggestions", () => {
  it("lists everyone for an empty query, busiest first", () => {
    expect(handles("")).toEqual(["turing", "ada", "grace"]);
  });

  it("finds people by handle, then by name, then by email or alias", () => {
    expect(handles("a")).toEqual(["ada", "turing", "grace"]);
    expect(handles("tur")).toEqual(["turing"]);
    expect(handles("hop")).toEqual(["grace"]);
    expect(handles("admiral")).toEqual(["grace"]);
    expect(handles("count")).toEqual(["ada"]);
    expect(handles("ove")).toEqual(["ada"]);
    expect(handles("zzz")).toEqual([]);
  });

  it("inserts the handle and a space unless one follows", () => {
    expect(mentionText(ada, "")).toBe("@ada ");
    expect(mentionText(ada, " and")).toBe("@ada");
    expect(mentionText(ada, ",")).toBe("@ada ");
  });
});

describe("MENTION_TRIGGER", () => {
  it("starts an @ after a space or at the start, not inside emails or words", () => {
    expect(MENTION_TRIGGER.exec("Ask @ad")?.[1]).toBe("ad");
    expect(MENTION_TRIGGER.exec("@")?.[1]).toBe("");
    expect(MENTION_TRIGGER.exec("(@grace.h")?.[1]).toBe("grace.h");
    expect(MENTION_TRIGGER.exec("mail ada@exa")).toBeNull();
    expect(MENTION_TRIGGER.exec("@ada @")?.[1]).toBe("");
  });
});
