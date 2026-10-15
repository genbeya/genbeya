/**
 * Reads a real Git directory: its refs, configuration and objects, packed
 * or loose. The web demo's experiment with real repositories uses it to
 * import a clone that wasm-git keeps in the browser's private file system
 * (see Architecture/Demo-real-repositories in the wiki); it reads Git's
 * file formats only and runs no Git.
 */
import { decodeLenient } from "../../utilities/bytes";

/** A Git directory (`.git`), read by paths relative to it. */
export interface GitDirectory {
  /** The file's bytes; null when there is no such file. */
  read(path: string): Promise<Uint8Array | null>;
  /** The names in a folder, with a trailing slash for folders; empty when there is no such folder. */
  list(path: string): Promise<string[]>;
}

/** Inflates zlib data, as `DecompressionStream("deflate")` does. */
export type Inflate = (data: Uint8Array) => Promise<Uint8Array>;

export type ObjectType = "commit" | "tree" | "blob" | "tag";

export interface GitObject {
  readonly type: ObjectType;
  readonly data: Uint8Array;
}

/** A ref and the object it names; `symbolic` when it names another ref, as `HEAD` does. */
export interface Ref {
  readonly name: string;
  readonly target: string;
  readonly symbolic: boolean;
}

const TYPES: Readonly<Record<number, ObjectType>> = { 1: "commit", 2: "tree", 3: "blob", 4: "tag" };
const OFS_DELTA = 6;
const REF_DELTA = 7;

const hex = (data: Uint8Array, start: number, end: number): string => {
  let text = "";
  for (let i = start; i < end; i++) text += data[i]!.toString(16).padStart(2, "0");
  return text;
};

const uint32 = (data: Uint8Array, at: number): number =>
  ((data[at]! << 24) | (data[at + 1]! << 16) | (data[at + 2]! << 8) | data[at + 3]!) >>> 0;

/** A packfile and its index (version 2), as `git index-pack` writes them. */
class Pack {
  /** Object offsets in the pack, by ID. */
  readonly offsets = new Map<string, number>();
  /** Where each object's data ends: the next object's offset, or the pack's checksum. */
  private readonly ends = new Map<number, number>();
  /** The offsets of objects that deltas are based on. */
  private readonly bases = new Set<number>();

  constructor(
    readonly name: string,
    private readonly pack: Uint8Array,
    index: Uint8Array,
  ) {
    if (uint32(index, 0) !== 0xff744f63 || uint32(index, 4) !== 2) throw new Error(`${name}.idx is not a version 2 pack index.`);
    if (decodeLenient(pack.subarray(0, 4)) !== "PACK") throw new Error(`${name}.pack is not a packfile.`);
    const count = uint32(index, 8 + 255 * 4);
    const names = 8 + 256 * 4;
    const offsets = names + count * 24;
    const large = offsets + count * 4;
    for (let i = 0; i < count; i++) {
      let offset = uint32(index, offsets + i * 4);
      // Packs over 2 GiB keep large offsets in a table of 64-bit ones.
      if (offset & 0x80000000)
        offset = Number(
          (BigInt(uint32(index, large + (offset & 0x7fffffff) * 8)) << 32n) | BigInt(uint32(index, large + (offset & 0x7fffffff) * 8 + 4)),
        );
      this.offsets.set(hex(index, names + i * 20, names + i * 20 + 20), offset);
    }
    const sorted = [...this.offsets.values()].sort((a, b) => a - b);
    sorted.forEach((offset, i) => this.ends.set(offset, sorted[i + 1] ?? pack.length - 20));
    for (const offset of sorted) {
      const { base } = this.entry(offset);
      if (base !== null) this.bases.add(typeof base === "number" ? base : (this.offsets.get(base) ?? -1));
    }
  }

  /** Whether a delta in this pack is based on the object at `offset`. */
  isBase(offset: number): boolean {
    return this.bases.has(offset);
  }

  get size(): number {
    return this.pack.length;
  }

  /** The object at `offset`: its type and size, and where its compressed data and (for deltas) its base are. */
  entry(offset: number): { type: number; start: number; end: number; base: number | string | null } {
    const data = this.pack;
    let at = offset;
    let byte = data[at++]!;
    const type = (byte >> 4) & 7;
    while (byte & 0x80) byte = data[at++]!;
    let base: number | string | null = null;
    if (type === OFS_DELTA) {
      byte = data[at++]!;
      let distance = byte & 0x7f;
      while (byte & 0x80) {
        byte = data[at++]!;
        distance = ((distance + 1) << 7) | (byte & 0x7f);
      }
      base = offset - distance;
    } else if (type === REF_DELTA) {
      base = hex(data, at, at + 20);
      at += 20;
    }
    return { type, start: at, end: this.ends.get(offset)!, base };
  }

  compressed(start: number, end: number): Uint8Array {
    return this.pack.subarray(start, end);
  }
}

/** Applies a Git delta to its base. */
export function applyDelta(base: Uint8Array, delta: Uint8Array): Uint8Array {
  let at = 0;
  const varint = () => {
    let value = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = delta[at++]!;
      value += (byte & 0x7f) * 2 ** shift;
      shift += 7;
    } while (byte & 0x80);
    return value;
  };
  if (varint() !== base.length) throw new Error("A delta doesn't fit its base object.");
  const result = new Uint8Array(varint());
  let out = 0;
  while (at < delta.length) {
    const op = delta[at++]!;
    if (op & 0x80) {
      let offset = 0;
      let size = 0;
      for (let bit = 0; bit < 4; bit++) if (op & (1 << bit)) offset += delta[at++]! * 2 ** (8 * bit);
      for (let bit = 0; bit < 3; bit++) if (op & (1 << (4 + bit))) size += delta[at++]! * 2 ** (8 * bit);
      if (size === 0) size = 0x10000;
      result.set(base.subarray(offset, offset + size), out);
      out += size;
    } else if (op) {
      result.set(delta.subarray(at, at + op), out);
      at += op;
      out += op;
    } else throw new Error("A delta has an unknown instruction.");
  }
  if (out !== result.length) throw new Error("A delta came out at the wrong size.");
  return result;
}

/** The objects and refs of a Git directory. */
export class GitObjects {
  private readonly packs: Pack[] = [];
  /** Resolved packed objects by pack and offset, since deltas share their bases. */
  private readonly resolved = new Map<string, GitObject>();
  inflated = 0;

  private constructor(
    private readonly directory: GitDirectory,
    private readonly inflate: Inflate,
  ) {}

  static async open(directory: GitDirectory, inflate: Inflate): Promise<GitObjects> {
    const objects = new GitObjects(directory, inflate);
    for (const file of await directory.list("objects/pack")) {
      if (!file.endsWith(".idx")) continue;
      const name = file.slice(0, -4);
      const [index, pack] = await Promise.all([directory.read(`objects/pack/${file}`), directory.read(`objects/pack/${name}.pack`)]);
      if (index && pack) objects.packs.push(new Pack(name, pack, index));
    }
    return objects;
  }

  /** The total size of the packfiles, in bytes. */
  get packBytes(): number {
    return this.packs.reduce((total, pack) => total + pack.size, 0);
  }

  get packedObjects(): number {
    return this.packs.reduce((total, pack) => total + pack.offsets.size, 0);
  }

  /** Whether the repository has the object `id`. */
  async has(id: string): Promise<boolean> {
    return (
      this.packs.some((pack) => pack.offsets.has(id)) || (await this.directory.read(`objects/${id.slice(0, 2)}/${id.slice(2)}`)) !== null
    );
  }

  /** The object `id` names. */
  async read(id: string): Promise<GitObject> {
    for (const pack of this.packs) {
      const offset = pack.offsets.get(id);
      if (offset !== undefined) return this.packed(pack, offset);
    }
    const loose = await this.directory.read(`objects/${id.slice(0, 2)}/${id.slice(2)}`);
    if (!loose) throw new Error(`The object ${id.slice(0, 7)} is missing from the repository.`);
    const data = await this.inflateCounted(loose);
    const space = data.indexOf(0x20);
    const nul = data.indexOf(0);
    const type = decodeLenient(data.subarray(0, space)) as ObjectType;
    return { type, data: data.subarray(nul + 1) };
  }

  private async packed(pack: Pack, offset: number): Promise<GitObject> {
    const key = `${pack.name}:${offset}`;
    const cached = this.resolved.get(key);
    if (cached) return cached;
    const entry = pack.entry(offset);
    const data = await this.inflateCounted(pack.compressed(entry.start, entry.end));
    let object: GitObject;
    if (entry.type === OFS_DELTA || entry.type === REF_DELTA) {
      const base = typeof entry.base === "number" ? await this.packed(pack, entry.base) : await this.read(entry.base!);
      object = { type: base.type, data: applyDelta(base.data, data) };
    } else {
      const type = TYPES[entry.type];
      if (!type) throw new Error(`${pack.name}.pack has an object of unknown type ${entry.type}.`);
      object = { type, data };
    }
    // Kept while deltas may need it as their base; the importer keeps the blobs' text itself.
    if (pack.isBase(offset)) this.resolved.set(key, object);
    return object;
  }

  private inflateCounted(data: Uint8Array): Promise<Uint8Array> {
    this.inflated++;
    return this.inflate(data);
  }

  /** Every ref: `HEAD`, the loose refs below `refs/` and the packed ones, loose ones first as Git reads them. */
  async refs(): Promise<Ref[]> {
    const refs = new Map<string, Ref>();
    const add = (name: string, value: string) => {
      const text = value.trim();
      const symbolic = text.startsWith("ref: ");
      if (!refs.has(name)) refs.set(name, { name, target: symbolic ? text.slice(5) : text, symbolic });
    };
    const head = await this.directory.read("HEAD");
    if (head) add("HEAD", decodeLenient(head));
    const walk = async (folder: string) => {
      for (const entry of await this.directory.list(folder)) {
        if (entry.endsWith("/")) await walk(`${folder}/${entry.slice(0, -1)}`);
        else {
          const data = await this.directory.read(`${folder}/${entry}`);
          if (data) add(`${folder}/${entry}`, decodeLenient(data));
        }
      }
    };
    await walk("refs");
    const packed = await this.directory.read("packed-refs");
    for (const line of packed ? decodeLenient(packed).split("\n") : []) {
      const match = /^([0-9a-f]{40}) (\S+)$/.exec(line);
      if (match) add(match[2]!, match[1]!);
    }
    return [...refs.values()];
  }

  /** The configuration, as sections of keys (`remote.origin` → `url`); a key given twice keeps its last value. */
  async config(): Promise<Map<string, Map<string, string>>> {
    const sections = new Map<string, Map<string, string>>();
    const data = await this.directory.read("config");
    let current: Map<string, string> | null = null;
    for (const raw of data ? decodeLenient(data).split("\n") : []) {
      const line = raw.trim();
      if (!line || line.startsWith("#") || line.startsWith(";")) continue;
      const section = /^\[\s*([^\s\]"]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\]$/.exec(line);
      if (section) {
        const name = section[2] === undefined ? section[1]!.toLowerCase() : `${section[1]!.toLowerCase()}.${section[2]}`;
        current = sections.get(name) ?? new Map();
        sections.set(name, current);
        continue;
      }
      const pair = /^([A-Za-z][A-Za-z0-9-]*)\s*(?:=\s*(.*))?$/.exec(line);
      if (pair && current) current.set(pair[1]!.toLowerCase(), pair[2] === undefined ? "true" : configValue(pair[2]));
    }
    return sections;
  }
}

/** A configuration value as Git reads it: quotes removed, escapes resolved, a comment outside quotes cut off. */
function configValue(raw: string): string {
  let value = "";
  let quoted = false;
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i]!;
    if (char === '"') quoted = !quoted;
    else if (char === "\\" && i + 1 < raw.length) {
      const next = raw[++i]!;
      value += next === "n" ? "\n" : next === "t" ? "\t" : next === "b" ? "\b" : next;
    } else if (!quoted && (char === "#" || char === ";")) break;
    else value += char;
  }
  return value.trimEnd();
}

/** A person and time in a commit or tag: `Name <email> 1700000000 +0200`. */
export function parsePerson(line: string): { name: string; email: string; date: string } {
  const match = /^(.*?)\s*<([^>]*)>\s*(-?\d+)\s*([+-])(\d\d)(\d\d)$/.exec(line);
  if (!match) return { name: line, email: "", date: new Date(0).toISOString().slice(0, 19) + "+00:00" };
  const [, name, email, seconds, sign, hours, minutes] = match;
  const offset = (sign === "-" ? -1 : 1) * (Number(hours) * 60 + Number(minutes));
  // Git's `%aI`: the writer's local time, with their offset.
  const local = new Date(Number(seconds) * 1000 + offset * 60_000).toISOString().slice(0, 19);
  return { name: name!, email: email!, date: `${local}${sign}${hours}:${minutes}` };
}

/** The headers and message of a commit or an annotated tag; continuation lines (signatures) are joined to their header. */
export function parseHeaders(data: Uint8Array): { headers: [string, string][]; message: string } {
  const text = decodeLenient(data);
  const split = text.indexOf("\n\n");
  const head = split < 0 ? text : text.slice(0, split);
  const headers: [string, string][] = [];
  for (const line of head.split("\n")) {
    if (line.startsWith(" ") && headers.length) headers[headers.length - 1]![1] += `\n${line.slice(1)}`;
    else {
      const space = line.indexOf(" ");
      headers.push([line.slice(0, space), line.slice(space + 1)]);
    }
  }
  return { headers, message: split < 0 ? "" : text.slice(split + 2) };
}

/** The entries of a tree object. */
export function parseTree(data: Uint8Array): { mode: string; name: string; id: string }[] {
  const entries: { mode: string; name: string; id: string }[] = [];
  let at = 0;
  while (at < data.length) {
    const space = data.indexOf(0x20, at);
    const nul = data.indexOf(0, space);
    entries.push({
      mode: decodeLenient(data.subarray(at, space)),
      name: decodeLenient(data.subarray(space + 1, nul)),
      id: hex(data, nul + 1, nul + 21),
    });
    at = nul + 21;
  }
  return entries;
}
