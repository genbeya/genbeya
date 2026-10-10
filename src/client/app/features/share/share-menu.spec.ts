import { CdkContextMenuTrigger } from "@angular/cdk/menu";
import { ChangeDetectionStrategy, Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import type { Snapshot } from "../../../../contracts/model";
import { openRepository, settle } from "../../testing/component-harness";
import { task } from "../../testing/fake-platform";
import { ShareMenu } from "./share-menu";

@Component({
  imports: [CdkContextMenuTrigger, ShareMenu],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <gd-share-menu #share="gdShareMenu" />
    <div class="row" tabindex="0" [cdkContextMenuTriggerFor]="share.menu()" [cdkContextMenuTriggerData]="{ $implicit: item }">TP-1</div>
  `,
})
class Host {
  readonly item = { kind: "task", id: "TP-1" };
}

async function rightClick(change: Partial<Snapshot>) {
  await openRepository({ tasks: [task("TP-1")], ...change });
  const fixture = TestBed.createComponent(Host);
  await settle(fixture);
  const row = (fixture.nativeElement as HTMLElement).querySelector(".row")!;
  const event = new MouseEvent("contextmenu", { button: 2, clientX: 10, clientY: 10, cancelable: true, bubbles: true });
  row.dispatchEvent(event);
  await settle(fixture);
  const items = [...document.querySelectorAll<HTMLElement>(".cdk-overlay-container [role=menuitem]")];
  return { event, items, item: (name: string) => items.find((item) => item.textContent!.includes(name)) };
}

describe("ShareMenu", () => {
  afterEach(() => document.querySelector(".cdk-overlay-container")?.replaceChildren());

  it("opens on right-click instead of the webview's menu, offering both links", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { event, items, item } = await rightClick({ remotes: [{ name: "origin", url: "https://github.com/acme/demo.git" }] });
    expect(event.defaultPrevented).toBe(true);
    expect(items.map((entry) => entry.textContent!.trim())).toEqual(["Copy GitDesk link", "Copy web link"]);
    item("Copy web link")!.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("https://github.com/acme/demo/blob/main/tasks/TP-1.md"));
  });

  it("explains why a repository without a remote can't be shared, and has no web link", async () => {
    const { items, item } = await rightClick({ remotes: [] });
    expect(items).toHaveLength(1);
    expect(item("Copy GitDesk link")!.getAttribute("aria-disabled")).toBe("true");
    expect(item("Copy GitDesk link")!.title).toMatch(/no remote/);
  });
});
