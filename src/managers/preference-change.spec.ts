import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES } from "../access/preferences/preferences-store";
import { changePreferences } from "./preference-change";

describe("changePreferences", () => {
  it("takes an editor font Genbeya ships, and ligatures on or off", () => {
    const next = changePreferences(DEFAULT_PREFERENCES, { editorFont: "fira-code", ligatures: false });
    expect(next).toMatchObject({ editorFont: "fira-code", ligatures: false, theme: DEFAULT_PREFERENCES.theme });
  });

  it("refuses other fonts and values of the wrong kind", () => {
    expect(() => changePreferences(DEFAULT_PREFERENCES, { editorFont: "Comic Sans" })).toThrow(/editor fonts/);
    expect(() => changePreferences(DEFAULT_PREFERENCES, { ligatures: "yes" })).toThrow(/ligatures/);
  });

  it("starts with JetBrains Mono and ligatures", () => {
    expect(DEFAULT_PREFERENCES).toMatchObject({ editorFont: "jetbrains-mono", ligatures: true });
  });
});
