import { relativeTime } from "./relative-time";

describe("relativeTime", () => {
  const now = Date.parse("2026-01-01T12:00:00Z");

  it("describes how long ago something happened", () => {
    expect(relativeTime("2026-01-01T11:57:00Z", now)).toMatch(/3 minutes ago/);
    expect(relativeTime("2024-01-01T12:00:00Z", now)).toMatch(/2 years ago/);
  });

  it("takes milliseconds too, and a short style for narrow places", () => {
    expect(relativeTime(now - 3 * 3_600_000, now)).toMatch(/3 hours ago/);
    expect(relativeTime(now - 3 * 3_600_000, now, "short")).toMatch(/3 hr\.? ago/);
  });
});
