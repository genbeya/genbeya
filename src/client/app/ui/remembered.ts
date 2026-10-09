/**
 * Layout choices remembered per device (panel widths, board or list).
 * Storage can be missing or full; a remembered choice is a convenience,
 * so failures fall back to the default.
 */
export function recall(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered this time.
  }
}
