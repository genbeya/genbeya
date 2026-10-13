import { ScrollLink } from "./scroll-link";

describe("ScrollLink", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("moves the other side, and ignores that side's echo", () => {
    const link = new ScrollLink();
    const moves: string[] = [];
    link.moved("editor", () => moves.push("preview follows"));
    // The preview's scroll event, caused by following.
    link.moved("preview", () => moves.push("editor follows"));
    expect(moves).toEqual(["preview follows"]);
  });

  it("lets either side lead once the echo has passed", () => {
    const link = new ScrollLink();
    const moves: string[] = [];
    link.moved("editor", () => moves.push("preview follows"));
    vi.advanceTimersByTime(200);
    link.moved("preview", () => moves.push("editor follows"));
    expect(moves).toEqual(["preview follows", "editor follows"]);
  });

  it("keeps ignoring the follower while its echoes go on", () => {
    const link = new ScrollLink();
    const moves: string[] = [];
    link.moved("editor", () => moves.push("preview follows"));
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(80);
      link.moved("preview", () => moves.push("editor follows"));
    }
    expect(moves).toEqual(["preview follows"]);
  });
});
