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

  it("finds a Genbeya link among the arguments, as operating systems pass it", () => {
    const link = "genbeya://open?remote=https://github.com/acme/demo.git&task=DP-1";
    expect(requestedLink(["Genbeya.exe", "--flag", link])).toEqual({
      remote: "https://github.com/acme/demo.git",
      item: { kind: "task", id: "DP-1" },
    });
    expect(requestedLink(["Genbeya.exe"])).toBeUndefined();
    expect(requestedLink(["Genbeya.exe", "genbeya://open?task=DP-1", 42])).toBeUndefined();
  });

  it("leaves out the links, for a page that already had them", () => {
    const flag = launchArgument({ kind: "local", path: "/r" });
    expect(withoutLinks(["Genbeya.exe", "Genbeya://open?remote=x&task=A", flag, "genbeya://open?task=B"])).toEqual(["Genbeya.exe", flag]);
  });
});
