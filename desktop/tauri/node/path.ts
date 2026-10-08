/** The parts of node:path the engine uses, for the platform the webview runs on. */
const windows = navigator.userAgent.includes("Windows");

function make(sep: "/" | "\\") {
  const split = (p: string) => (sep === "\\" ? p.replace(/\//g, "\\") : p);
  const join = (...parts: string[]) => {
    const joined = split(parts.filter(Boolean).join(sep));
    // Collapse repeated separators, keeping a leading UNC `\\`.
    const unc = sep === "\\" && joined.startsWith("\\\\");
    const out = joined.replace(sep === "\\" ? /\\+/g : /\/+/g, sep);
    return unc ? sep + out : out;
  };
  const dirname = (p: string) => {
    const s = split(p);
    const cut = s.lastIndexOf(sep);
    return cut <= 0 ? (cut === 0 ? sep : ".") : /^[A-Za-z]:$/.test(s.slice(0, cut)) ? s.slice(0, cut + 1) : s.slice(0, cut);
  };
  const basename = (p: string) => split(p).slice(split(p).lastIndexOf(sep) + 1);
  // Roots arrive absolute (folder picker, saved state); normalise them only.
  const resolve = (...parts: string[]) => join(...parts).replace(/(.)[\\/]+$/, "$1");
  return { sep, join, dirname, basename, resolve };
}

const posix = make("/");
const native = windows ? make("\\") : posix;
const path = { ...native, posix };

export default path;
