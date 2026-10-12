/** Replaces `connect.ts` in the web demo's build (angular.json): the page hosts the managers itself, which load in a chunk of their own. */
import type { Platform } from "./platform";

export async function connectPlatform(): Promise<Platform> {
  return (await import("./demo-connector")).connectDemo();
}
