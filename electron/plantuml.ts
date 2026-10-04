import { spawn } from "node:child_process";
import { deflateRawSync } from "node:zlib";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";

/** PlantUML's URL encoding: raw deflate, then a custom base64 alphabet. */
export function encodePlantUml(source: string) {
  const data = deflateRawSync(Buffer.from(source, "utf8"), { level: 9 });
  let out = "";
  for (let i = 0; i < data.length; i += 3) {
    const [a, b = 0, c = 0] = [data[i], data[i + 1], data[i + 2]];
    out +=
      ALPHABET[a >> 2] +
      ALPHABET[((a & 3) << 4) | (b >> 4)] +
      ALPHABET[((b & 15) << 2) | (c >> 6)] +
      ALPHABET[c & 63];
  }
  return out;
}

function renderLocally(source: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("plantuml", ["-tsvg", "-pipe", "-charset", "UTF-8"], {
      windowsHide: true,
      shell: process.platform === "win32",
    });
    const out: Buffer[] = [];
    let err = "";
    const timer = setTimeout(() => child.kill(), 20_000);
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => (err += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      const svg = Buffer.concat(out).toString("utf8");
      if (code === 0 && svg.includes("<svg")) resolve(svg);
      else reject(new Error(err.trim() || "PlantUML could not render this diagram."));
    });
    child.stdin.end(source);
  });
}

const cache = new Map<string, string>();

/**
 * Renders with the configured server, or with a local `plantuml` command.
 * Diagram source is never sent anywhere unless a server is configured.
 */
export async function renderPlantUml(source: string, server: string, fetcher: typeof fetch) {
  if (typeof source !== "string" || source.length > 200_000) throw new Error("Diagram is too large.");
  const key = server + "\0" + source;
  const cached = cache.get(key);
  if (cached) return cached;
  let svg: string;
  if (server) {
    const response = await fetcher(`${server}/svg/${encodePlantUml(source)}`);
    if (!response.ok) throw new Error(`PlantUML server responded with ${response.status}.`);
    svg = await response.text();
  } else {
    try {
      svg = await renderLocally(source);
    } catch (error: any) {
      if (error.code === "ENOENT" || /not recognized|not found/i.test(error.message))
        throw new Error("Install PlantUML or set a PlantUML server in Preferences to render this diagram.");
      throw error;
    }
  }
  if (cache.size > 200) cache.clear();
  cache.set(key, svg);
  return svg;
}
