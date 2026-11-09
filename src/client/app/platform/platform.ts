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
  /** How the badge describes the page; the demo's own words unless given. */
  readonly about?: DemoAbout;
}

/** What the badge says about a page that runs Genbeya in the browser. */
export interface DemoAbout {
  /** The badge's tooltip. */
  readonly title: string;
  /** The badge's label, such as "Demo". */
  readonly pill: string;
  /** Next to the label. */
  readonly caption: string;
  /** What the page is, at the top of the badge's menu. */
  readonly note: string;
  /** How the menu offers {@link DemoControls.reset}, and how it asks first. */
  readonly reset: { readonly label: string; readonly title: string; readonly message: string };
  /** Another page the menu offers, such as the repository on GitHub. */
  readonly link?: { readonly label: string; readonly url: string };
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
