import { ChangeDetectionStrategy, Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { provideRouter, withComponentInputBinding } from "@angular/router";
import { RouterTestingHarness } from "@angular/router/testing";
import { Dialogs } from "./dialogs";
import { guardedBy, trackUnsaved, UnsavedChanges } from "./unsaved-changes";

const dirty = signal(false);

@Component({ changeDetection: ChangeDetectionStrategy.OnPush, template: "" })
class Editor {
  constructor() {
    trackUnsaved(dirty);
  }
}

async function setup() {
  dirty.set(false);
  const dialogs = { confirm: vi.fn(async () => false) };
  TestBed.configureTestingModule({
    providers: [
      { provide: Dialogs, useValue: dialogs },
      provideRouter(
        [
          { path: "wiki", component: Editor, ...guardedBy("page") },
          { path: "tasks", component: Editor },
        ],
        withComponentInputBinding(),
      ),
    ],
  });
  const harness = await RouterTestingHarness.create("/wiki?page=a");
  return { dialogs, harness };
}

describe("unsaved changes", () => {
  it("asks before leaving the route or opening another page with unsaved edits", async () => {
    const { dialogs, harness } = await setup();
    dirty.set(true);
    harness.detectChanges();
    await harness.navigateByUrl("/wiki?page=b");
    await harness.navigateByUrl("/tasks");
    expect(dialogs.confirm).toHaveBeenCalledTimes(2);
    expect(TestBed.inject(UnsavedChanges).any()).toBe(true);
  });

  it("does not ask when only other parameters change", async () => {
    const { dialogs, harness } = await setup();
    dirty.set(true);
    harness.detectChanges();
    await harness.navigateByUrl("/wiki?page=a&anchor=x");
    expect(dialogs.confirm).not.toHaveBeenCalled();
  });
});
