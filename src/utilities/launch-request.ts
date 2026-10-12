/**
 * What a launch asks for. `--open=<base64url JSON location>` opens a
 * repository (jump list entries carry it); a `genbeya://open?…` link, as the
 * operating system passes it, opens an item. The receiving side validates
 * the location; links are validated here.
 */
import type { GenbeyaLink } from "../contracts/genbeya-link";
import { encodeText, toBase64 } from "./bytes";
import { parseGenbeyaLink } from "./genbeya-link";

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

/** The first valid Genbeya link among the arguments, or undefined. */
export function requestedLink(args: readonly unknown[]): GenbeyaLink | undefined {
  for (const arg of args) {
    const link = parseGenbeyaLink(arg);
    if (link) return link;
  }
  return undefined;
}

/** The arguments without Genbeya links, valid or not: a page that reloads must not open a launch's link again. */
export const withoutLinks = (args: readonly string[]): string[] => args.filter((arg) => !/^genbeya:/i.test(arg));
