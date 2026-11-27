/**
 * Plans over time in Markdown: `[BURNDOWN]` draws remaining and logged
 * effort day by day, `[BASELINE v1.0]` lists what changed since the
 * baseline. Both read the tasks' history from Git once per repository
 * state, and render as Markdown of their own.
 */
import { Injectable, inject } from "@angular/core";
import type { PlanHistory } from "../../../contracts/model";
import { Session } from "../core/session";
import { WorkspaceApi } from "../core/workspace-api";
import type { GenbeyaOptions } from "./markdown-pipeline";
import { planHistoryMarkdown } from "./plan-history-markdown";

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
  markdown(kind: "BURNDOWN" | "BASELINE", args: string, plan: NonNullable<GenbeyaOptions["plan"]>): Promise<string> {
    return planHistoryMarkdown(kind, args, plan, (baseline) => this.load(baseline));
  }
}
