/** Replaces `connect.ts` in the GitHub build (angular.json): the page reads a repository from GitHub and hosts the managers itself. */
import type { Platform } from "./platform";

export async function connectPlatform(): Promise<Platform> {
  return (await import("./github-connector")).connectGitHub();
}
