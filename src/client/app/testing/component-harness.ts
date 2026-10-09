/** Test setup for feature components: fake platform, router, dialogs and diagrams, and an open repository. */
import { provideRouter, Router } from "@angular/router";
import { TestBed } from "@angular/core/testing";
import type { Snapshot } from "../../../contracts/model";
import { Dialogs } from "../core/dialogs";
import { Session } from "../core/session";
import { Diagrams } from "../markdown/diagrams";
import { fakeManagers, fakeShell, providePlatform, snapshot as makeSnapshot } from "./fake-platform";

export interface Harness {
  readonly managers: ReturnType<typeof fakeManagers>;
  readonly shell: ReturnType<typeof fakeShell>;
  readonly dialogs: {
    prompt: ReturnType<typeof vi.fn>;
    confirm: ReturnType<typeof vi.fn>;
    discardEdits: ReturnType<typeof vi.fn>;
    open: ReturnType<typeof vi.fn>;
  };
  readonly router: Router;
  readonly session: Session;
}

/** Configures TestBed and opens a repository with `snapshot`. */
export async function openRepository(change: Partial<Snapshot> = {}): Promise<Harness> {
  const managers = fakeManagers();
  const shell = fakeShell();
  const dialogs = {
    prompt: vi.fn(async () => null),
    confirm: vi.fn(async () => true),
    discardEdits: vi.fn(async () => true),
    open: vi.fn(async () => undefined),
  };
  managers.workspace.open.mockResolvedValue({ id: "w1", snapshot: makeSnapshot(change) });
  TestBed.configureTestingModule({
    providers: [
      ...providePlatform(managers, shell),
      provideRouter([]),
      { provide: Dialogs, useValue: dialogs },
      { provide: Diagrams, useValue: { draw: vi.fn(async () => ({ svg: "<svg></svg>", isError: false })) } },
    ],
  });
  const session = TestBed.inject(Session);
  await session.open({ kind: "local", path: "/repo" });
  return { managers, shell, dialogs, router: TestBed.inject(Router), session };
}

/** Lets pending promises and effects settle. */
export const settle = async (fixture?: { whenStable(): Promise<unknown> }) => {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture?.whenStable();
  }
};
