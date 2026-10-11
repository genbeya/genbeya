import { describe, expect, it } from "vitest";
import { concatBytes, decodeLenient, encodeText } from "../../utilities/bytes";
import type { ChildProcess, ProcessRunner } from "../ports";
import { ShellSession } from "./shell-session";

/**
 * A remote sh that answers every request with `reply`, delivered in chunks
 * of `size` bytes, as a slow connection would.
 */
function fakeShell(reply: (request: number) => { stdout: Uint8Array; stderr: string }, size: number): ProcessRunner {
  return {
    run: () => Promise.reject(new Error("Not used.")),
    spawn(): ChildProcess {
      let stdout: (chunk: Uint8Array) => void = () => undefined;
      let requests = -1;
      const send = (data: Uint8Array) => {
        for (let offset = 0; offset < data.length; offset += size) stdout(data.subarray(offset, offset + size));
      };
      return {
        write() {
          // The first write is the bootstrap script; login banners may come before the marker.
          if (++requests === 0) return send(encodeText("Welcome!\r\nGDK-READY\n"));
          const { stdout: out, stderr } = reply(requests);
          const header = encodeText(`GDK 0 ${out.length} ${encodeText(stderr).length}\r\n`);
          send(concatBytes([header, out, encodeText(stderr)]));
        },
        end: () => undefined,
        kill: () => undefined,
        onStdout: (listener) => (stdout = listener),
        onStderr: () => undefined,
        onExit: () => undefined,
      };
    },
  };
}

describe("ShellSession", () => {
  it("keeps requests in step when replies arrive in pieces", async () => {
    const session = new ShellSession(
      fakeShell((request) => ({ stdout: encodeText(`out ${request}\n`), stderr: `err ${request}` }), 3),
      "sh",
      [],
      "fake",
    );
    for (const request of [1, 2, 3]) {
      const result = await session.exec("true");
      expect(decodeLenient(result.stdout)).toBe(`out ${request}\n`);
      expect(result.stderr).toBe(`err ${request}`);
    }
  });

  it("collects large outputs in time linear in their size", async () => {
    const large = new Uint8Array(32 * 1024 * 1024).map((_, i) => i % 251);
    // Small chunks: copying everything received so far for each of them would take minutes.
    const session = new ShellSession(
      fakeShell(() => ({ stdout: large, stderr: "" }), 2048),
      "sh",
      [],
      "fake",
    );
    const result = await session.exec("true");
    expect(result.stdout.length).toBe(large.length);
    expect(result.stdout.every((byte, i) => byte === i % 251)).toBe(true);
    expect((await session.exec("true")).stdout.length).toBe(large.length);
  });
});
