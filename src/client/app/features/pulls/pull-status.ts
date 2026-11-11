import type { PullStatus } from "../../../../contracts/model";
import type { IconName } from "../../ui/icon-data";

export const STATUS_LABELS: Readonly<Record<PullStatus, string>> = { draft: "Draft", open: "Open", merged: "Merged", closed: "Closed" };

export const STATUS_ICONS: Readonly<Record<PullStatus, IconName>> = {
  draft: "git-pull-request-draft",
  open: "git-pull-request",
  merged: "git-merge",
  closed: "git-pull-request-closed",
};
