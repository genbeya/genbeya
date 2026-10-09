/** Small signal helpers shared by features. */
import { effect, signal, type Signal } from "@angular/core";

/** Structural equality for computed values rebuilt from snapshots, so unchanged results do not notify. */
export const sameJson = <T>(a: T, b: T): boolean => JSON.stringify(a) === JSON.stringify(b);

/** `source`, updated only after it has been still for `delay` milliseconds. */
export function debounced<T>(source: Signal<T>, delay: number): Signal<T> {
  const value = signal(source());
  effect((onCleanup) => {
    const next = source();
    const timer = setTimeout(() => value.set(next), delay);
    onCleanup(() => clearTimeout(timer));
  });
  return value.asReadonly();
}
