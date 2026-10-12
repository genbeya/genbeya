/**
 * The history the web demo gives the sample repository, so that every view
 * has something to try: teammates' commits, a tag, a branch whose merge
 * into main conflicts in one line of the README, everything pushed to a
 * simulated remote, and a commit there that a fetch brings in.
 */
import type { SampleFile } from "./sample-engine";

export interface DemoAuthor {
  readonly name: string;
  readonly email: string;
}

/** One step of building the demo repository, in order. */
export type DemoStep =
  /** Commits `files` on the current branch, or on the remote's `branch` only when `remote` is set. */
  | {
      readonly kind: "commit";
      readonly message: string;
      readonly author: DemoAuthor;
      readonly hoursAgo: number;
      readonly files: readonly SampleFile[];
      readonly remote?: { readonly branch: string };
    }
  | { readonly kind: "branch"; readonly name: string }
  | { readonly kind: "switch"; readonly branch: string }
  | { readonly kind: "tag"; readonly name: string; readonly message: string }
  /** Pushes a branch to the remote, which it then tracks. */
  | { readonly kind: "push"; readonly branch: string };

const text = (...lines: string[]) => `${lines.join("\n")}\n`;

const SAM: DemoAuthor = { name: "Sam Rivera", email: "sam@example.com" };
const ALEX: DemoAuthor = { name: "Alex Chen", email: "alex@example.com" };

const USAGE = (line: string) => text("", "## Usage", "", line);

const UNITS = text(
  "/** Degrees Celsius in Fahrenheit, rounded to whole degrees. */",
  "export const toFahrenheit = (celsius: number): number => Math.round((celsius * 9) / 5 + 32);",
);

const UNITS_TEST = text(
  'import { strictEqual } from "node:assert";',
  'import { toFahrenheit } from "./units";',
  "",
  "strictEqual(toFahrenheit(0), 32);",
  "strictEqual(toFahrenheit(21), 70);",
);

const FORECAST_SOURCE_UNITS = "| `high`, `low` | Temperatures in °C, or °F with `--fahrenheit` |";

export class DemoEngine {
  /** Where the simulated remote says it is. */
  readonly remoteUrl = "https://git.example.com/pocket-weather.git";

  /** How many hours ago the sample's commit `index` was made: a day apart, the first one five days ago. */
  sampleHoursAgo(index: number): number {
    return 120 - 24 * index;
  }

  /**
   * The steps after the sample's own commits (which `readme` and
   * `forecastSource` are the committed versions of), before its last,
   * uncommitted change.
   */
  steps(readme: string, forecastSource: string): readonly DemoStep[] {
    return [
      { kind: "tag", name: "v0.1", message: "The first plan" },
      { kind: "branch", name: "fahrenheit" },
      { kind: "switch", branch: "fahrenheit" },
      {
        kind: "commit",
        message: "Convert temperatures to Fahrenheit",
        author: SAM,
        hoursAgo: 50,
        files: [
          { path: "src/units.ts", content: UNITS },
          { path: "README.md", content: readme + USAGE("Run `npx tsx src/forecast.ts Zurich --fahrenheit` for temperatures in °F.") },
        ],
      },
      {
        kind: "commit",
        message: "Test the conversion",
        author: SAM,
        hoursAgo: 49,
        files: [{ path: "src/units.test.ts", content: UNITS_TEST }],
      },
      { kind: "push", branch: "fahrenheit" },
      { kind: "switch", branch: "main" },
      {
        kind: "commit",
        message: "Explain how to run the report",
        author: ALEX,
        hoursAgo: 26,
        files: [{ path: "README.md", content: readme + USAGE("Run `npx tsx src/forecast.ts Zurich` for a three-day report.") }],
      },
      { kind: "push", branch: "main" },
      {
        kind: "commit",
        message: "Mention Fahrenheit on the forecast source page",
        author: SAM,
        hoursAgo: 3,
        remote: { branch: "main" },
        files: [
          {
            path: "docs/Architecture/Forecast-source.md",
            content: forecastSource.replace(/^\| `high`, `low` \|.*$/m, FORECAST_SOURCE_UNITS),
          },
        ],
      },
    ];
  }
}
