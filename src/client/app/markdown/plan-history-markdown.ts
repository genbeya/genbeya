/**
 * What `[BURNDOWN]` and `[BASELINE v1.0]` show, as Markdown of their own:
 * a burn chart, or what changed since the baseline. Plain, so every
 * renderer draws them the same way; `load` reads the tasks' history from
 * whatever holds the repository (the managers, a host).
 */
import type { PlanHistory } from "../../../contracts/model";
import { baselineComparison, baselineMarkdown, burnChart, burnDown } from "../../../utilities/plan-history";
import { parseFilter } from "../../../utilities/planning";
import type { GenbeyaOptions } from "./markdown-pipeline";

export async function planHistoryMarkdown(
  kind: "BURNDOWN" | "BASELINE",
  args: string,
  plan: NonNullable<GenbeyaOptions["plan"]>,
  load: (baseline: string | null) => Promise<PlanHistory>,
): Promise<string> {
  const words = args.trim().split(/\s+/).filter(Boolean);
  const revision = kind === "BASELINE" ? (words.find((word) => !word.includes("=")) ?? null) : null;
  const filter = parseFilter(words.filter((word) => word !== revision).join(" "));
  if (kind === "BASELINE" && !revision) return "*Name the baseline, a tag or commit: `[BASELINE v1.0]`.*";
  const history = await load(revision);
  const truncated = history.truncated ? "\n\n*Only the newest commits of the tasks are read.*" : "";
  if (kind === "BASELINE") {
    if (!history.baseline?.commit) return `*This repository has no commit or tag ${revision}.*`;
    return baselineMarkdown(baselineComparison(history, plan.tasks, filter, plan.statuses), revision!) + truncated;
  }
  const chart = burnChart(burnDown(history, plan.tasks, filter, plan.statuses, plan.today));
  if (!chart) return "*Not enough history for a burn chart yet: it needs commits on more than one day.*";
  return `\`\`\`mermaid\n${chart}\n\`\`\`\n\n*Bars: hours left; line: hours logged so far, by the day of each commit.*${truncated}`;
}
