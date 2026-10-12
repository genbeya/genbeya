/** What the client needs from its desktop shell: the managers and the shell's own services. */
import { InjectionToken } from "@angular/core";
import type { Managers } from "../../../contracts/manager-contracts";
import type { ShellContract } from "../../../contracts/shell";

/** The web demo's own controls: it runs in a web page, with a simulated backend. */
export interface DemoControls {
  /** Starts over with the sample project as it was; every change is gone. */
  reset(): void;
  /** Where to get Genbeya itself. */
  readonly downloadUrl: string;
}

export interface Platform {
  readonly managers: Managers;
  readonly shell: ShellContract;
  /** Where layout choices are remembered; the page's local storage unless given. */
  readonly storage?: Pick<Storage, "getItem" | "setItem">;
  /** Only in the web demo. */
  readonly demo?: DemoControls;
}

export const MANAGERS = new InjectionToken<Managers>("Genbeya managers");
export const SHELL = new InjectionToken<ShellContract>("Genbeya shell");
/** The web demo's controls; null in the app. */
export const DEMO = new InjectionToken<DemoControls | null>("Genbeya demo", { providedIn: "root", factory: () => null });
