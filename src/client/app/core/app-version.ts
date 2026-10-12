/**
 * The app's version, from package.json at build time. Only `version` is
 * bundled: esbuild drops the properties of a JSON module nobody imports.
 */
import { version } from "../../../../package.json";

export const APP_VERSION: string = version;
