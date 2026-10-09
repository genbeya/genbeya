import { describe, expect, it, vi } from "vitest";
import { MANAGER_METHODS, type Managers } from "./manager-contracts";
import { connectManagers, dispatch, type Request } from "./rpc";

// Fails to compile when a contract method is missing from MANAGER_METHODS.
type Unlisted<K extends keyof Managers> = Exclude<keyof Managers[K], (typeof MANAGER_METHODS)[K][number]>;
const exhaustive: [Unlisted<"workspace">, Unlisted<"content">, Unlisted<"versionControl">] extends [never, never, never] ? true : false = true;

const fakeManagers = () =>
  ({
    workspace: { recent: vi.fn(async () => [{ name: "a" }]), close: vi.fn(async () => undefined) },
    content: { read: vi.fn(async () => Promise.reject(new Error("a.md does not exist."))) },
    versionControl: {},
  }) as unknown as Managers;

describe("rpc", () => {
  it("lists every contract method exactly once", () => {
    expect(exhaustive).toBe(true);
    for (const methods of Object.values(MANAGER_METHODS)) expect(new Set(methods).size).toBe(methods.length);
  });

  it("dispatches listed methods and wraps results", async () => {
    const managers = fakeManagers();
    expect(await dispatch(managers, { manager: "workspace", method: "recent", args: [] })).toEqual({ ok: true, value: [{ name: "a" }] });
    expect(await dispatch(managers, { manager: "workspace", method: "close", args: ["id"] })).toEqual({ ok: true, value: null });
    expect(managers.workspace.close).toHaveBeenCalledWith("id");
  });

  it("turns failures into messages", async () => {
    expect(await dispatch(fakeManagers(), { manager: "content", method: "read", args: [] })).toEqual({
      ok: false,
      message: "a.md does not exist.",
    });
  });

  it.each([
    null,
    { manager: "workspace", method: "toString", args: [] },
    { manager: "constructor", method: "open", args: [] },
    { manager: "workspace", method: "recent", args: "x" },
  ])("rejects unknown request %j", async (request) => {
    expect(await dispatch(fakeManagers(), request)).toEqual({ ok: false, message: "Unknown request." });
  });

  it("connects typed managers to a transport, end to end", async () => {
    const backend = fakeManagers();
    const managers = connectManagers((request: Request) => dispatch(backend, structuredClone(request)));
    expect(await managers.workspace.recent()).toEqual([{ name: "a" }]);
    await expect(managers.content.read("w", "repo", "a.md")).rejects.toThrow("a.md does not exist.");
  });
});
