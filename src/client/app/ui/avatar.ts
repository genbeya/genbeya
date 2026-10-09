import { ChangeDetectionStrategy, Component, computed, input } from "@angular/core";

const COLORS = ["#7c7ff2", "#4cb782", "#e8955a", "#5e9eef", "#d46aa8", "#ddb345", "#a77ee6", "#3fb5b5"];

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
  protected readonly initials = computed(
    () =>
      this.name()
        .split(/[\s._@-]+/)
        .filter(Boolean)
        .map((word) => word[0])
        .slice(0, 2)
        .join("")
        .toUpperCase() || "?",
  );
  protected readonly color = computed(() => {
    let hash = 0;
    for (const character of this.name()) hash = (hash * 31 + character.charCodeAt(0)) | 0;
    return COLORS[Math.abs(hash) % COLORS.length];
  });
}
