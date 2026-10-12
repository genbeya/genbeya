import { describe, expect, it } from "vitest";
import { launchArgument, requestedLink, requestedLocation, withoutLinks } from "./launch-request";

describe("launch requests", () => {
  it("round-trips locations with any characters", () => {
    const location = { kind: "local", path: "C:\\Ünïcode ~?/+" };
    const argument = launchArgument(location);
    expect(argument).toMatch(/^--open=[A-Za-z0-9_-]+$/);
    expect(requestedLocation(["app.exe", "--flag", argument])).toEqual(location);
  });

  it("ignores launches without a request and malformed requests", () => {
    expect(requestedLocation(["app.exe"])).toBeUndefined();
    expect(requestedLocation(["--open=!!!"])).toBeUndefined();
    expect(requestedLocation([42, null])).toBeUndefined();
  });

  it.each(["genbeya", "gitdesk"])("finds a %s:// link among the arguments, as operating systems pass it", (scheme) => {
    const link = `${scheme}://open?remote=https://github.com/acme/demo.git&task=DP-1`;
    expect(requestedLink(["Genbeya.exe", "--flag", link])).toEqual({
      remote: "https://github.com/acme/demo.git",
      item: { kind: "task", id: "DP-1" },
    });
    expect(requestedLink(["Genbeya.exe"])).toBeUndefined();
    expect(requestedLink(["Genbeya.exe", `${scheme}://open?task=DP-1`, 42])).toBeUndefined();
  });

  it("leaves out the links of either scheme, for a page that already had them", () => {
    const flag = launchArgument({ kind: "local", path: "/r" });
    const links = ["Genbeya://open?remote=x&task=A", "genbeya://open?task=B", "GitDesk://open?remote=x&task=C", "gitdesk://open?task=D"];
    expect(withoutLinks(["Genbeya.exe", links[0]!, flag, ...links.slice(1), "genbeya-notes.txt"])).toEqual([
      "Genbeya.exe",
      flag,
      "genbeya-notes.txt",
    ]);
  });
});
