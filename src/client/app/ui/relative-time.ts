/** How long ago something happened, as everywhere in GitDesk shows it. */

const UNITS: readonly (readonly [size: number, unit: Intl.RelativeTimeFormatUnit])[] = [
  [60, "second"],
  [60, "minute"],
  [24, "hour"],
  [7, "day"],
  [4.35, "week"],
  [12, "month"],
  [Infinity, "year"],
];

/**
 * "3 minutes ago", "yesterday", "2 years ago", in the user's language; with
 * the short style "3 min. ago", for narrow places. `time` is an ISO date or
 * milliseconds since the epoch.
 */
export function relativeTime(time: string | number, now = Date.now(), style: Intl.RelativeTimeFormatStyle = "long"): string {
  let value = (now - new Date(time).getTime()) / 1000;
  for (const [size, unit] of UNITS) {
    if (Math.abs(value) < size) return new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style }).format(-Math.round(value), unit);
    value /= size;
  }
  return "";
}
