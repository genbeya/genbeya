/** The content and version control managers, bound to the open repository. */
import { Injectable, inject } from "@angular/core";
import { MANAGER_METHODS, type ContentManagerContract, type VersionControlManagerContract } from "../../../contracts/manager-contracts";
import { MANAGERS } from "../platform/platform";
import { Session } from "./session";

/** A contract without its leading workspace parameter. */
export type Bound<T> = {
  readonly [K in keyof T]: T[K] extends (workspace: string, ...args: infer A) => infer R ? (...args: A) => R : never;
};

@Injectable({ providedIn: "root" })
export class WorkspaceApi {
  private readonly managers = inject(MANAGERS);
  private readonly session = inject(Session);
  readonly content = this.bind("content") as Bound<ContentManagerContract>;
  readonly versionControl = this.bind("versionControl") as Bound<VersionControlManagerContract>;

  private bind(manager: "content" | "versionControl") {
    const target = this.managers[manager] as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    return Object.fromEntries(
      MANAGER_METHODS[manager].map((method) => [
        method,
        (...args: unknown[]) => {
          const id = this.session.id();
          if (!id) return Promise.reject(new Error("No repository is open."));
          return target[method]!(id, ...args);
        },
      ]),
    );
  }
}
