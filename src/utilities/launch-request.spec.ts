import { describe, expect, it } from "vitest";
import { launchArgument, requestedLink, requestedLocation } from "./launch-request";

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

  it("finds a GitDesk link among the arguments, as operating systems pass it", () => {
    const link = "gitdesk://open?remote=https://github.com/acme/demo.git&task=DP-1";
    expect(requestedLink(["GitDesk.exe", "--flag", link])).toEqual({
      remote: "https://github.com/acme/demo.git",
      item: { kind: "task", id: "DP-1" },
    });
    expect(requestedLink(["GitDesk.exe"])).toBeUndefined();
    expect(requestedLink(["GitDesk.exe", "gitdesk://open?task=DP-1", 42])).toBeUndefined();
  });
});
