const pad = (value: number) => String(value).padStart(2, "0");

/** `date` in local time to the minute, with the UTC offset: "2026-10-10 14:32+02:00", as comments and replies are signed. */
export function timestampOf(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const zone = `${offset < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}${zone}`;
}
