// The text this file writes into users' repositories is licensed under MIT-0 (LICENSE-MIT-0.md).
/**
 * The history the web demo gives the sample repository, so that every view
 * has something to try: teammates' commits, a tag, a branch whose merge
 * into main conflicts in one line of the README, an icon drawn twice,
 * everything pushed to a simulated remote, and a commit there that a fetch
 * brings in.
 */
import { fromBase64 } from "../utilities/bytes";

export interface DemoAuthor {
  readonly name: string;
  readonly email: string;
}

/** A file of a demo commit: text, or bytes such as an image's. */
export interface DemoFile {
  readonly path: string;
  readonly content: string | Uint8Array;
}

/** One step of building the demo repository, in order. */
export type DemoStep =
  /** Commits `files` on the current branch, or on the remote's `branch` only when `remote` is set. */
  | {
      readonly kind: "commit";
      readonly message: string;
      readonly author: DemoAuthor;
      readonly hoursAgo: number;
      readonly files: readonly DemoFile[];
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

/** The app's icon, a sun, as a 96 × 96 PNG. */
const ICON =
  "iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAACDUlEQVR42u2cy42DMBRFKSElsPRySqAUSqAEOqAESqADU4JLSAnZe8MIKWhGiBCT+O9zpacsAtZ79wgwNnZVIYQQQgghhFAC0lL0WoplFz3OAAAACAAAQAAAAAIAABAAgpjzo6VQ628uAHzUZDPRx9OQh6uEfQLwVZPtRBeXCfsC4LMmG8mqA1OcJOwDwAvzt1CpXAFOILgG4LOWJCG4BJCs+TkUkLz5KReSjfkpFpSd+SkVlq35KRSYvfmGhQ4B8xqyN/8NhPHC+bWWotNSTFqK+cC0+fnfekx9od0xe/NfQBgNz2lP3rLPYj2nvQghX/N3EAaD4xotxf0D4/exttEY3o7yNt8Q0O3gtmAj1jZvFXprvnJg/v/bEhACmQ+ECMwHgmFX0EeMOP/X21kCRQMAO13Nj7uopZvfBjR/i7ZkACoCAKpU8+sIzN+iLhFAFxGArkQAU0QAppiN6r+Jk3bniADMvuu/AuCr4ly1azt81w8AAAAAAIkA4CEc8iFMN5QXMV7EGIpgMI7BOIajmZBhQoYpyXwhMCkfGACfpRQEAfMDQsB8Qwh8nOvQYD5PD2w+CzQiMJ8lShGYzyK9CMxnmWrpBbJKnlwpqGKnFHJPqgA2bAqcOFuWHSfNpn0RXgFsWxkQAhu3BoTA1sU5i827AQAAAAAAAAAAAAAAAAAAAAAACCGEEEIIIWSsX1AeO+3VRsP2AAAAAElFTkSuQmCC";

/** The icon again, smaller, with a cloud in front of the sun. */
const ICON_CLOUD =
  "iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAAEeElEQVR42u1cQWsTQRTuT8hP6HGP8SoIuXvJwauwFy+ecvPao7fiJYIKq1ttKa3G6rZKLbsqWCjYLiJFRUvIpYKVRkQUchl5YSdM090km+zuzOx8Hzwo3ezM7vfNvPfmzSRzcwAAAAAgGT3fYqKBEQgAAQAIAAEACAABAAigJGFOz7ds1QWgZ6RnLRv5oUCWraoAEfm8zbBMI58Nma2aAEPkc3PKIEDci80sQpYC5PWMpRYhcmtBZCHI1/BFjSFfxRc2jnyVXtxY8lUgwHjyxxBhT3hvtedbtZ5vNSKjv6t591t2Eewxn633fKvV861uwghm0TX6TD2rfk0RwR5xnUZ3ewTpSUb31KbtF7Uj36okrKLTGrVRAaPpyQ8zIH9Q14EI8siHCBkU77IyBwyPJr+WI/ncamA6WYB2AQK0wXRyns8KsjoYPy9Aq0ABWmD8vADdvIn/s3OBfd28wnafNv41XS9oul7YdD02ZGF0baHpevWm61VMIL+aJ/FE+ubaTRZD9qTWIjFUJS91Pl5U9kPELy0vnSFzeeM1e7N3yD587rBvnR/s56+/Z4z+R9foM/RZ8V5qi9pU6jjMFMQEMW00siT+9NVF1lq9NSDuwfoO2z34wjrHp+cIH2d0D91LbfD2qG3qAwLE2KF3ld17uNYn6u7KS/b+41Fq0pOM2qI2qW3qg/qCCxLs7ZMbg1G6sb3Hvp/8zox8btQmtS24pkUEYd9iO48XBqRkOepHzQZBhFKcH+rOOvLJPXw6Os6dfG7UF3dJ2s+EaRdi5If5SCySfFEEYSbYOgtQnybb4QG3CLczgTvqNl1v3phiHE81KSjKIp+bEJgDI8rRtCDifj+PbGea7EiIB3WdRXCG3czBs2v9UoK4uCoy45nCFbV1FqC/JUnBdXXlzsgaDa1OVSGfm7Bi1nMWNF2vdtt93uEk07TeCvb7o0tGlpPWqGzBC3i6EV+hBY04ulVyL2lqR8IsrejgcuyT7UvXeW2eRjyNIt2IF02oolIZ21ZWCCKfNkm4r6cHjysR62ZUyo6JWY5Sa4Q48lVIJ7NKSSle0Uxe33o3LMSi9BnBD8fyAlqZyE+KC5RIDG17VqWS33lxeZDllMHtTGL0nkJ86BYugngsnG8V6h5wZ9xPKE4EkXxewVRxISWhdhTmHhOGv5XCA6+OeX6WM0FwR4uFkU+1He77TSVfjAlCYJ7PS4AzxTUqrFGHlBWYLgCZkB05ec6CwXn/R8v39013P1JKF/znaqJjf1oU1ooyYbGW/5YmVxvEx1ZQHQggwYSN/QACSEpJOS8QQJIVKQCCsGQBWkhD5bqgBhZicoPwPEoREtPQSIQQbkjSQiwSwDa9HC39FAWdHjNxQ0ZKMS7pAJZpW5JSytFjRHBM2JSXuiEzwWm40EQRCt2STCNC2d2RtE35SUUow9FEZY+lmHA4V/mDWRNmR21dj6drcTQxxWItnOEHNlQzR8sv8EW1o0ZURQ00IjyISLeN+MkbAAAAAAAAAAAAAAAAAAAAAAAyw3/VOEE9+sCrqgAAAABJRU5ErkJggg==";

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
        message: "Add an icon",
        author: ALEX,
        hoursAgo: 30,
        files: [{ path: "assets/icon.png", content: fromBase64(ICON) }],
      },
      {
        kind: "commit",
        message: "Put a cloud in front of the sun",
        author: ALEX,
        hoursAgo: 28,
        files: [{ path: "assets/icon.png", content: fromBase64(ICON_CLOUD) }],
      },
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
