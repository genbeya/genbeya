/** node:zlib's deflateRawSync, used to encode PlantUML URLs. */
import { deflateSync } from "fflate";

export const deflateRawSync = (data: Uint8Array, options?: { level?: number }) =>
  Buffer.from(deflateSync(data, { level: (options?.level ?? 6) as 6 }));
