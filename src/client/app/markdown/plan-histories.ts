/**
 * Plans over time in Markdown: `[BURNDOWN]` draws remaining and logged
 * effort day by day, `[BASELINE v1.0]` lists what changed since the
 * baseline. Both read the tasks' history from Git once per repository
 * state, and render as Markdown of their own.
 */
import { Injectable, inject } from "@angular/core";
import type { PlanHistory } from "../../../contracts/model";
import { baselineComparison, baselineMarkdown, burnChart, burnDown } from "../../../utilities/plan-history";
import { parseFilter } from "../../../utilities/planning";
import { Session } from "../core/session";
import { WorkspaceApi } from "../core/workspace-api";
import type { GenbeyaOptions } from "./markdown-pipeline";

@Injectable({ providedIn: "root" })
export class PlanHistories {
  private readonly api = inject(WorkspaceApi);
  private readonly session = inject(Session);
  private version: string | null = null;
  private readonly loaded = new Map<string, Promise<PlanHistory>>();

  /** The history, with the tasks at `baseline` when given; read again once the repository changed. */
  load(baseline: string | null): Promise<PlanHistory> {
    const version = this.session.snapshot()?.version ?? null;
    if (version !== this.version) {
      this.version = version;
      this.loaded.clear();
    }
    let history = this.loaded.get(baseline ?? "");
    if (!history) {
      history = this.api.content.planHistory(baseline);
      history.catch(() => this.loaded.delete(baseline ?? ""));
      this.loaded.set(baseline ?? "", history);
    }
    return history;
  }

  /** The Markdown a plan over time shows: a burn chart, or the changes since a baseline. */
  async markdown(kind: "BURNDOWN" | "BASELINE", args: string, plan: NonNullable<GenbeyaOptions["plan"]>): Promise<string> {
    const words = args.trim().split(/\s+/).filter(Boolean);
    const revision = kind === "BASELINE" ? (words.find((word) => !word.includes("=")) ?? null) : null;
    const filter = parseFilter(words.filter((word) => word !== revision).join(" "));
    if (kind === "BASELINE" && !revision) return "*Name the baseline, a tag or commit: `[BASELINE v1.0]`.*";
    const history = await this.load(revision);
    const truncated = history.truncated ? "\n\n*Only the newest commits of the tasks are read.*" : "";
    if (kind === "BASELINE") {
      if (!history.baseline?.commit) return `*This repository has no commit or tag ${revision}.*`;
      return baselineMarkdown(baselineComparison(history, plan.tasks, filter, plan.statuses), revision!) + truncated;
    }
    const chart = burnChart(burnDown(history, plan.tasks, filter, plan.statuses, plan.today));
    if (!chart) return "*Not enough history for a burn chart yet: it needs commits on more than one day.*";
    return `\`\`\`mermaid\n${chart}\n\`\`\`\n\n*Bars: hours left; line: hours logged so far, by the day of each commit.*${truncated}`;
  }
}
