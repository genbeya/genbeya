import { ChangeDetectionStrategy, Component, computed, input } from "@angular/core";
import { avatarHue, initials } from "./avatar-hue";

export { avatarHue, initials } from "./avatar-hue";

/** Initials on a colour derived from the name, so a person keeps their colour everywhere. */
@Component({
  selector: "gd-avatar",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: "avatar",
    "[attr.title]": "name()",
    "[style.width.px]": "size()",
    "[style.height.px]": "size()",
    "[style.font-size.px]": "size() * 0.42",
    "[style.background]": "color()",
  },
  template: `{{ initials() }}`,
})
export class Avatar {
  readonly name = input.required<string>();
  readonly size = input(20);
  protected readonly initials = computed(() => initials(this.name()));
  protected readonly color = computed(() => `var(--avatar-${avatarHue(this.name())})`);
}
