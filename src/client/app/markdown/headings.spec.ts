import { headingAt } from "./headings";

const PAGE = [
  "# Home",
  "",
  "Intro.",
  "",
  "## Setup",
  "",
  "```sh",
  "# not a heading",
  "```",
  "",
  "## Setup",
  "Again.",
  "",
  "Underlined",
  "---",
].join("\n");

describe("headingAt", () => {
  it("finds the heading above a line, with the ids pages render", () => {
    expect(headingAt(PAGE, 1)).toBe("home");
    expect(headingAt(PAGE, 3)).toBe("home");
    expect(headingAt(PAGE, 8)).toBe("setup");
    expect(headingAt(PAGE, 13)).toBe("setup-1");
  });

  it("knows setext headings by the line they start on", () => {
    expect(headingAt(PAGE, 14)).toBe("underlined");
  });

  it("finds nothing above the first heading", () => {
    expect(headingAt("Text first.\n\n# Later\n", 1)).toBeNull();
  });
});
