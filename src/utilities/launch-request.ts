/**
 * Asks a launch to open a repository: `--open=<base64url JSON location>`.
 * Jump list entries carry it; the receiving side validates the location.
 */
import { encodeText, toBase64 } from "./bytes";

const FLAG = "--open=";

export const launchArgument = (location: unknown): string =>
  FLAG +
  toBase64(encodeText(JSON.stringify(location)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** The requested location, unvalidated, or undefined when no argument asks for one. */
export function requestedLocation(args: readonly unknown[]): unknown {
  const argument = args.find((arg): arg is string => typeof arg === "string" && arg.startsWith(FLAG));
  if (!argument) return undefined;
  try {
    const binary = atob(argument.slice(FLAG.length).replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))));
  } catch {
    return undefined;
  }
}
