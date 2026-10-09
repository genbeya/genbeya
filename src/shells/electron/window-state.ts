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

const FILE = "window.json";
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
