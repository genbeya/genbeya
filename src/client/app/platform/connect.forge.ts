/** Replaces `connect.ts` in the forge build (angular.json): the page reads a repository from its forge and hosts the managers itself. */
import type { Platform } from "./platform";

export async function connectPlatform(): Promise<Platform> {
  return (await import("./forge-connector")).connectForge();
}
