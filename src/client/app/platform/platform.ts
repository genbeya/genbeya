/** What the client needs from its desktop shell: the managers and the shell's own services. */
import { InjectionToken } from "@angular/core";
import type { Managers } from "../../../contracts/manager-contracts";
import type { ShellContract } from "../../../contracts/shell";

export interface Platform {
  readonly managers: Managers;
  readonly shell: ShellContract;
}

export const MANAGERS = new InjectionToken<Managers>("Genbeya managers");
export const SHELL = new InjectionToken<ShellContract>("Genbeya shell");
