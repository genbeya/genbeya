import { describe, expect, it } from "vitest";
import { launchArgument, requestedLocation } from "./launch-request";

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
});
