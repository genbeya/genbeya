import { ChangeDetectionStrategy, Component, input } from "@angular/core";
import {
  LucideArrowDownToLine,
  LucideArrowUpFromLine,
  LucideBookOpen,
  LucideCircleDot,
  LucideCloudDownload,
  LucideCodeXml,
  LucideFileCode2,
  LucideFileText,
  LucideFolderOpen,
  LucideGitBranch,
  LucideGitBranchPlus,
  LucideGitCommitHorizontal,
  LucideGitMerge,
  LucideHistory,
  LucideKeyboard,
  LucideLayoutGrid,
  LucideLink,
  LucideMonitor,
  LucideMoon,
  LucidePlus,
  LucideRefreshCw,
  LucideServer,
  LucideSquareTerminal,
  LucideSun,
  LucideSunMoon,
  LucideX,
} from "@lucide/angular";
import type { PaletteIcon as Icon } from "./palette-items";

@Component({
  selector: "gd-palette-icon",
  imports: [
    LucideArrowDownToLine,
    LucideArrowUpFromLine,
    LucideBookOpen,
    LucideCircleDot,
    LucideCloudDownload,
    LucideCodeXml,
    LucideFileCode2,
    LucideFileText,
    LucideFolderOpen,
    LucideGitBranch,
    LucideGitBranchPlus,
    LucideGitCommitHorizontal,
    LucideGitMerge,
    LucideHistory,
    LucideKeyboard,
    LucideLayoutGrid,
    LucideLink,
    LucideMonitor,
    LucideMoon,
    LucidePlus,
    LucideRefreshCw,
    LucideServer,
    LucideSquareTerminal,
    LucideSun,
    LucideSunMoon,
    LucideX,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: "display: contents" },
  template: `
    @switch (icon()) {
      @case ("page") {
        <svg lucideBookOpen [size]="15" aria-hidden="true"></svg>
      }
      @case ("wiki") {
        <svg lucideBookOpen [size]="15" aria-hidden="true"></svg>
      }
      @case ("task") {
        <svg lucideFileText [size]="15" aria-hidden="true"></svg>
      }
      @case ("tasks") {
        <svg lucideLayoutGrid [size]="15" aria-hidden="true"></svg>
      }
      @case ("file") {
        <svg lucideFileCode2 [size]="15" aria-hidden="true"></svg>
      }
      @case ("code") {
        <svg lucideCodeXml [size]="15" aria-hidden="true"></svg>
      }
      @case ("changes") {
        <svg lucideGitCommitHorizontal [size]="15" aria-hidden="true"></svg>
      }
      @case ("history") {
        <svg lucideHistory [size]="15" aria-hidden="true"></svg>
      }
      @case ("branch") {
        <svg lucideGitBranch [size]="15" aria-hidden="true"></svg>
      }
      @case ("current-branch") {
        <svg lucideCircleDot [size]="15" aria-hidden="true"></svg>
      }
      @case ("remote-branch") {
        <svg lucideCloudDownload [size]="15" aria-hidden="true"></svg>
      }
      @case ("add-branch") {
        <svg lucideGitBranchPlus [size]="15" aria-hidden="true"></svg>
      }
      @case ("merge") {
        <svg lucideGitMerge [size]="15" aria-hidden="true"></svg>
      }
      @case ("add") {
        <svg lucidePlus [size]="15" aria-hidden="true"></svg>
      }
      @case ("fetch") {
        <svg lucideRefreshCw [size]="15" aria-hidden="true"></svg>
      }
      @case ("sync") {
        <svg lucideRefreshCw [size]="15" aria-hidden="true"></svg>
      }
      @case ("pull") {
        <svg lucideArrowDownToLine [size]="15" aria-hidden="true"></svg>
      }
      @case ("push") {
        <svg lucideArrowUpFromLine [size]="15" aria-hidden="true"></svg>
      }
      @case ("folder") {
        <svg lucideFolderOpen [size]="15" aria-hidden="true"></svg>
      }
      @case ("local") {
        <svg lucideFolderOpen [size]="15" aria-hidden="true"></svg>
      }
      @case ("server") {
        <svg lucideServer [size]="15" aria-hidden="true"></svg>
      }
      @case ("ssh") {
        <svg lucideServer [size]="15" aria-hidden="true"></svg>
      }
      @case ("wsl") {
        <svg lucideMonitor [size]="15" aria-hidden="true"></svg>
      }
      @case ("clone") {
        <svg lucideCloudDownload [size]="15" aria-hidden="true"></svg>
      }
      @case ("close") {
        <svg lucideX [size]="15" aria-hidden="true"></svg>
      }
      @case ("dark") {
        <svg lucideMoon [size]="15" aria-hidden="true"></svg>
      }
      @case ("light") {
        <svg lucideSun [size]="15" aria-hidden="true"></svg>
      }
      @case ("system") {
        <svg lucideSunMoon [size]="15" aria-hidden="true"></svg>
      }
      @case ("keyboard") {
        <svg lucideKeyboard [size]="15" aria-hidden="true"></svg>
      }
      @case ("terminal") {
        <svg lucideSquareTerminal [size]="15" aria-hidden="true"></svg>
      }
      @case ("link") {
        <svg lucideLink [size]="15" aria-hidden="true"></svg>
      }
    }
  `,
})
export class PaletteIcon {
  readonly icon = input.required<Icon>();
}
