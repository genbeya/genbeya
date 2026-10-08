/** node:crypto's createHash("sha256"), the only hash the engine uses. */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

export function createHash(algorithm: string) {
  if (algorithm !== "sha256") throw new Error(`Unsupported hash ${algorithm}.`);
  const hash = sha256.create();
  const api = {
    update(data: string | Uint8Array) {
      hash.update(typeof data === "string" ? utf8ToBytes(data) : data);
      return api;
    },
    digest: (encoding: "hex") => (encoding === "hex" ? bytesToHex(hash.digest()) : hash.digest()),
  };
  return api;
}

export const randomUUID = () => crypto.randomUUID();
