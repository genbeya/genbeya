/** Node globals the engine expects; imported before anything else. */
import { Buffer } from "buffer";

const agent = navigator.userAgent;
Object.assign(globalThis, {
  Buffer,
  process: {
    platform: agent.includes("Windows") ? "win32" : agent.includes("Mac OS") ? "darwin" : "linux",
    env: {},
    versions: {},
    argv: [],
  },
});
