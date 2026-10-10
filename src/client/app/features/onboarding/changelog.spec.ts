import { compareVersions, parseVersion } from "../../../../utilities/version";
import { CHANGELOG, news, newsTour, type Release } from "./changelog";

const release = (version: string, ...targets: (string | undefined)[]): Release => ({
  version,
  items: targets.map((target, i) => ({ title: `${version} #${i}`, body: "News.", ...(target ? { target } : {}) })),
});

const changelog = [release("1.2", "#a"), release("1.1", undefined), release("1.0", "#b", undefined), release("0.9")];
const versions = (releases: readonly Release[]) => releases.map((entry) => entry.version);

describe("news", () => {
  it("lists the releases after the last seen one, up to the running one", () => {
    expect(versions(news(changelog, "1.2.0", "1.0.7"))).toEqual(["1.2", "1.1"]);
    expect(versions(news(changelog, "1.1.3", "0.1.0"))).toEqual(["1.1", "1.0"]);
  });

  it("counts every build of a release line as that release", () => {
    expect(news(changelog, "1.2.9", "1.2.0")).toEqual([]);
    expect(versions(news(changelog, "1.2.0", "1.1.40"))).toEqual(["1.2"]);
  });

  it("lists everything up to the running release without a last seen version", () => {
    expect(versions(news(changelog, "1.1.0"))).toEqual(["1.1", "1.0"]);
  });

  it("lists nothing for versions it cannot read", () => {
    expect(news(changelog, "dev")).toEqual([]);
    expect(news(changelog, "1.2.0", "unknown")).toEqual([]);
  });
});

describe("newsTour", () => {
  it("points at the items that name an element", () => {
    expect(newsTour(changelog).map((step) => step.target)).toEqual(["#a", "#b"]);
  });
});

describe("CHANGELOG", () => {
  it("names release lines, newest first, each with news", () => {
    for (const entry of CHANGELOG) {
      expect(entry.version).toMatch(/^\d+\.\d+$/);
      expect(entry.items.length).toBeGreaterThan(0);
    }
    const lines = CHANGELOG.map((entry) => parseVersion(entry.version)!);
    expect(lines).toEqual([...lines].sort((a, b) => compareVersions(b, a)));
  });
});
