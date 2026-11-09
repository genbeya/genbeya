/** The reader for each forge. */
import type { Forge } from "../../utilities/forge-address";
import { bitbucket } from "./bitbucket";
import type { ForgeReader } from "./forge";
import { gitea } from "./gitea";
import { github } from "./github";
import { gitlab } from "./gitlab";

export const FORGE_READERS: Readonly<Record<Forge, ForgeReader>> = { github, gitlab, bitbucket, codeberg: gitea, gitea, forgejo: gitea };
