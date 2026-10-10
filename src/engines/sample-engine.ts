/**
 * The sample repository new users can try GitDesk with: a small project
 * whose wiki shows references, embeds, subpages and diagrams, whose tasks
 * span the workflow and an epic, with a few commits of history and one
 * change left to commit.
 */

export interface SampleFile {
  readonly path: string;
  readonly content: string;
}

export interface SampleStep {
  /** The commit message; a step without one stays uncommitted, so Changes has something to show. */
  readonly message?: string;
  readonly files: readonly SampleFile[];
}

const text = (...lines: string[]) => `${lines.join("\n")}\n`;

const SETTINGS = text(
  "# Shared GitDesk settings of this repository. Edit them in Settings or here;",
  "# comments and keys GitDesk does not know are kept.",
  "name: Pocket Weather",
  "wikiRoot: docs",
  "wikiHome: Home.md",
  "taskRoot: tasks",
  "taskPrefix: PW",
  "statuses:",
  "  - backlog",
  "  - todo",
  "  - in-progress",
  "  - review",
  "  - done",
  "# The board leaves these out; the list still shows them.",
  "hiddenColumns:",
  "  - backlog",
);

const README = text(
  "# Pocket Weather",
  "",
  "A sample repository made by GitDesk to try it with. The wiki is in `docs/`, the tasks are in `tasks/`,",
  "the shared settings in `.gitdesk.yml`. Delete the folder when you are done.",
);

const forecast = (days: readonly string[]) =>
  text(
    "/** Pocket Weather: a three-day forecast, printed as a short report. */",
    "",
    "export interface Day {",
    "  readonly date: string;",
    "  readonly summary: string;",
    "  readonly high: number;",
    "  readonly low: number;",
    "}",
    "",
    '/** One line per day: "Mon 14  Sunny  21° / 12°". */',
    "export function report(days: readonly Day[]): string {",
    "  return days",
    "    .map((day) => `${day.date.padEnd(8)}${day.summary.padEnd(16)}${day.high}° / ${day.low}°`)",
    '    .join("\\n");',
    "}",
    "",
    "/** A canned forecast until the real source exists (PW-3). */",
    "export function forecast(city: string): Day[] {",
    "  return [",
    ...days,
    "  ];",
    "}",
    "",
    'console.log(report(forecast(process.argv[2] ?? "Zurich")));',
  );

const DAYS = [
  '    { date: "Mon 14", summary: `Sunny in ${city}`, high: 21, low: 12 },',
  '    { date: "Tue 15", summary: "Cloudy", high: 18, low: 11 },',
  '    { date: "Wed 16", summary: "Rain", high: 15, low: 9 },',
];

/** The lines of `report` in src/forecast.ts, which the wiki and a task embed. */
export const REPORT_LINES = "src/forecast.ts#L11-L15";

const HOME = text(
  "# Pocket Weather",
  "",
  "A tiny command-line weather report, and a sample project to try GitDesk with.",
  "Everything here is a plain file in the repository: this page is `docs/Home.md`.",
  "",
  "> [!TIP]",
  "> Press `E` to edit this page. Type `[[` to link a page, a task or a file.",
  "",
  "[TOC]",
  "",
  "## References",
  "",
  "`[[…]]` points at anything in the repository and stays up to date:",
  "",
  "- A page: [[Architecture]], or its subpage [[Forecast source]]",
  "- A task: [[PW-2]] shows its title and state. Plain task IDs such as PW-1 link too.",
  `- A file: [[src/forecast.ts]], or some of its lines: [[${REPORT_LINES}]]`,
  "- A page that does not exist yet: [[Release notes]]. Click it to create it.",
  "",
  "## Embeds",
  "",
  "A file reference on its own line, starting with `!`, shows the lines themselves, always in their current version:",
  "",
  `![[${REPORT_LINES}]]`,
  "",
  "## Pages",
  "",
  "[SUBPAGES]",
);

const ARCHITECTURE = text(
  "# Architecture",
  "",
  "Pocket Weather reads a forecast, turns it into a report and prints it.",
  "",
  "```mermaid",
  "flowchart LR",
  "  source[Forecast source] --> report[Report] --> terminal[Terminal]",
  "```",
  "",
  "PlantUML works as well, rendered on your machine:",
  "",
  "```plantuml",
  "actor User",
  "User -> CLI: pocket-weather Zurich",
  'CLI -> Source: forecast("Zurich")',
  "Source --> CLI: three days",
  "CLI --> User: report",
  "```",
  "",
  "This page is `docs/Architecture.md`; its subpages live in the folder `docs/Architecture/`:",
  "",
  "[SUBPAGES]",
);

const FORECAST_SOURCE = text(
  "# Forecast source",
  "",
  "A subpage of [[Architecture]]. Today the forecast is made up in [[src/forecast.ts]];",
  "[[PW-3]] replaces it with a real weather service.",
  "",
  "| Field | Meaning |",
  "| --- | --- |",
  "| `date` | Weekday and day of the month |",
  "| `summary` | Sunny, cloudy, rain… |",
  "| `high`, `low` | Temperatures in °C |",
);

const WHERE_FILES_LIVE = text(
  "# Where files live",
  "",
  "GitDesk keeps nothing in a database: everything it shows is a file in this repository,",
  "so any editor, script or Git host works with it too.",
  "",
  "| What | Where |",
  "| --- | --- |",
  "| Wiki pages | Markdown files in `docs/`. `Architecture.md` and the folder `Architecture/` make a page with subpages |",
  "| Tasks | One Markdown file per task in `tasks/`, its fields as YAML frontmatter. A folder below `tasks/` is an epic |",
  "| Settings | `.gitdesk.yml`: the project name, the folders, the task prefix and the workflow states |",
  "| Code | Everything else, such as [[src/forecast.ts]] |",
  "",
  "Edits are ordinary changes: review and commit them in **Changes**. A team can keep the wiki, the tasks",
  "or the settings on a shared content branch instead, each on its own: **Settings → Where content lives**.",
);

const task = (id: string, fields: readonly string[], ...body: string[]) => text("---", `id: ${id}`, ...fields, "---", "", ...body);

const TASKS: readonly SampleFile[] = [
  {
    path: "tasks/PW-1.md",
    content: task(
      "PW-1",
      ["title: Print the forecast as a report", "status: done", "priority: medium", "labels: [cli]"],
      "One line per day:",
      "",
      `![[${REPORT_LINES}]]`,
    ),
  },
  {
    path: "tasks/PW-2.md",
    content: task(
      "PW-2",
      ["title: Show temperatures in Fahrenheit", "status: in-progress", "priority: medium", "assignee: sam", "labels: [cli]"],
      "Add `--fahrenheit` to switch units. Tick the boxes right here, without editing:",
      "",
      "- [x] Convert in the report",
      "- [ ] Read the flag",
      "- [ ] Mention it on [[Home]]",
    ),
  },
  {
    path: "tasks/PW-3.md",
    content: task(
      "PW-3",
      ["title: Fetch real forecasts", "status: todo", "priority: high", "labels: [data]"],
      "Replace the canned forecast with the service described in [[Forecast source]].",
    ),
  },
  {
    path: "tasks/PW-4.md",
    content: task(
      "PW-4",
      ["title: Warn about storms", "status: backlog", "priority: low"],
      "Waits in the backlog, which the board hides (`hiddenColumns` in `.gitdesk.yml`). The list shows it.",
    ),
  },
  {
    path: "tasks/Release 1.0/PW-5.md",
    content: task(
      "PW-5",
      ["title: Write the README", "status: review", "priority: medium", "assignee: alex", "labels: [docs]"],
      "Tasks in a folder below `tasks/` belong to an epic: this one is in *Release 1.0*.",
      "Turn on swimlanes on the board to see one row per epic.",
    ),
  },
  {
    path: "tasks/Release 1.0/PW-6.md",
    content: task("PW-6", ["title: Publish the first release", "status: todo", "priority: high"], "Once PW-2 and PW-3 are done."),
  },
];

const STEPS: readonly SampleStep[] = [
  {
    message: "Start Pocket Weather",
    files: [
      { path: "README.md", content: README },
      { path: ".gitdesk.yml", content: SETTINGS },
      { path: "src/forecast.ts", content: forecast(DAYS) },
    ],
  },
  {
    message: "Write the wiki",
    files: [
      { path: "docs/Home.md", content: HOME },
      { path: "docs/Architecture.md", content: ARCHITECTURE },
      { path: "docs/Architecture/Forecast-source.md", content: FORECAST_SOURCE },
      { path: "docs/Where-files-live.md", content: WHERE_FILES_LIVE },
    ],
  },
  { message: "Plan the first release", files: TASKS },
  { files: [{ path: "src/forecast.ts", content: forecast([...DAYS, '    { date: "Thu 17", summary: "Windy", high: 16, low: 8 },']) }] },
];

export class SampleEngine {
  /** The folder the sample repository is created in, below the folder the user chose. */
  readonly folderName = "gitdesk-sample";

  /** The files of the sample, in the commits that create it. */
  steps(): readonly SampleStep[] {
    return STEPS;
  }
}
