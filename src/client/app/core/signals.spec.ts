import { Component, computed, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { debounced, sameJson } from "./signals";

@Component({ template: "" })
class Host {
  readonly source = signal("a");
  readonly value = debounced(this.source, 100);
}

describe("signal helpers", () => {
  it("follows the source once it has been still", async () => {
    vi.useFakeTimers();
    const host = TestBed.createComponent(Host).componentInstance;
    host.source.set("ab");
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(50);
    host.source.set("abc");
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(50);
    expect(host.value()).toBe("a");
    await vi.advanceTimersByTimeAsync(100);
    expect(host.value()).toBe("abc");
    vi.useRealTimers();
  });

  it("keeps structurally equal results from notifying", () => {
    const pages = signal([{ title: "Home" }]);
    const links = computed(() => ({ pages: pages().map((page) => page.title) }), { equal: sameJson });
    const first = links();
    pages.set([{ title: "Home" }]);
    expect(links()).toBe(first);
    pages.set([{ title: "Other" }]);
    expect(links()).not.toBe(first);
  });
});
