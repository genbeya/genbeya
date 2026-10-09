import { describe, expect, it } from "vitest";
import { posixPaths, windowsPaths } from "./native-path";

describe("posixPaths", () => {
  it("joins and normalises separators", () => {
    expect(posixPaths.join("/home/me", "repo", "docs/Home.md")).toBe("/home/me/repo/docs/Home.md");
    expect(posixPaths.join("/home/me/", "/x")).toBe("/home/me/x");
  });

  it("finds parents", () => {
    expect(posixPaths.dirname("/home/me/repo")).toBe("/home/me");
    expect(posixPaths.dirname("/repo")).toBe("/");
  });

  it("normalises roots", () => {
    expect(posixPaths.normalize("/home/me/repo/")).toBe("/home/me/repo");
    expect(posixPaths.normalize("/")).toBe("/");
  });
});

describe("windowsPaths", () => {
  it("joins with backslashes", () => {
    expect(windowsPaths.join("C:\\code", "repo", "docs/Home.md")).toBe("C:\\code\\repo\\docs\\Home.md");
    expect(windowsPaths.join("C:/code/", "x")).toBe("C:\\code\\x");
  });

  it("keeps UNC prefixes", () => {
    expect(windowsPaths.join("\\\\wsl$\\Ubuntu\\home", "me")).toBe("\\\\wsl$\\Ubuntu\\home\\me");
  });

  it("finds parents, keeping drive roots", () => {
    expect(windowsPaths.dirname("C:\\code\\repo")).toBe("C:\\code");
    expect(windowsPaths.dirname("C:\\code")).toBe("C:\\");
  });

  it("normalises git's forward-slash output", () => {
    expect(windowsPaths.normalize("C:/code/repo")).toBe("C:\\code\\repo");
    expect(windowsPaths.normalize("C:\\code\\repo\\")).toBe("C:\\code\\repo");
    expect(windowsPaths.normalize("C:\\")).toBe("C:\\");
  });
});
