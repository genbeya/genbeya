/** The window's size and position between launches. */
import { promises as fs } from "node:fs";
import path from "node:path";

export interface WindowBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly maximized: boolean;
}

export interface Area {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const FILE = "window.json";
/** The part of the title bar that must be on a screen, so the window can still be dragged. */
const GRIP = { width: 100, height: 40 };

/**
 * `bounds` fitted to the screen holding its title bar, or null when no
 * screen does (a monitor was removed, the resolution changed).
 */
export function placeOnScreen(bounds: WindowBounds, screens: readonly Area[]): WindowBounds | null {
  // The title bar's top edge on the screen, with enough of its width to grab.
  const area = screens.find(
    (a) =>
      Math.min(bounds.x + bounds.width, a.x + a.width) - Math.max(bounds.x, a.x) >= Math.min(GRIP.width, bounds.width) &&
      bounds.y >= a.y &&
      bounds.y + GRIP.height <= a.y + a.height,
  );
  if (!area) return null;
  const width = Math.min(bounds.width, area.width);
  const height = Math.min(bounds.height, area.height);
  const x = Math.min(Math.max(bounds.x, area.x), area.x + area.width - width);
  const y = Math.min(Math.max(bounds.y, area.y), area.y + area.height - height);
  return { ...bounds, x, y, width, height };
}
const SAVE_DELAY = 500;

export class WindowState {
  private timer: ReturnType<typeof setTimeout> | null = null;

  private constructor(
    private readonly folder: string,
    private current: WindowBounds | null,
  ) {}

  static async load(folder: string): Promise<WindowState> {
    try {
      const saved = JSON.parse(await fs.readFile(path.join(folder, FILE), "utf8")) as WindowBounds;
      const valid = ["x", "y", "width", "height"].every((key) => Number.isFinite(saved[key as keyof WindowBounds]));
      return new WindowState(folder, valid ? saved : null);
    } catch {
      return new WindowState(folder, null);
    }
  }

  get bounds(): WindowBounds | null {
    return this.current;
  }

  remember(bounds: WindowBounds): void {
    this.current = bounds;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), SAVE_DELAY);
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.current) return;
    await fs.mkdir(this.folder, { recursive: true });
    await fs.writeFile(path.join(this.folder, FILE), JSON.stringify(this.current));
  }
}
