import { ChangeDetectionStrategy, Component, computed, input } from "@angular/core";
import { LucideFolderOpen, LucideMonitor, LucideServer } from "@lucide/angular";
import type { Location } from "../../../../contracts/model";

/** "GitDesk" → "GD", "my project" → "MP", "atlas" → "AT". */
export function initials(name: string): string {
  const words = name.split(/[\s_-]+/).filter(Boolean);
  const capitals = name.match(/[A-Z]/g);
  return (words.length > 1 ? words.map((word) => word[0]).join("") : capitals && capitals.length > 1 ? capitals.join("") : name.slice(0, 2))
    .slice(0, 2)
    .toUpperCase();
}

/** The icon of where a repository lives: this computer, WSL or SSH. */
@Component({
  selector: "gd-host-icon",
  imports: [LucideFolderOpen, LucideMonitor, LucideServer],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: "display: contents" },
  template: `
    @switch (kind()) {
      @case ("ssh") {
        <svg lucideServer [size]="size()" aria-hidden="true"></svg>
      }
      @case ("wsl") {
        <svg lucideMonitor [size]="size()" aria-hidden="true"></svg>
      }
      @default {
        <svg lucideFolderOpen [size]="size()" aria-hidden="true"></svg>
      }
    }
  `,
})
export class HostIcon {
  readonly location = input.required<Location>();
  readonly size = input(13);
  protected readonly kind = computed(() => this.location().kind);
}
