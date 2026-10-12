/**
 * Absolute paths on the machine a repository lives on. The style is chosen by
 * the host, not by the process Genbeya runs in: a Windows app opening a WSL
 * repository uses POSIX paths for it.
 */
export interface PathStyle {
  readonly separator: "/" | "\\";
  join(...parts: string[]): string;
  dirname(path: string): string;
  /** Unifies separators and drops a trailing separator (except at a root). */
  normalize(path: string): string;
}

function style(separator: "/" | "\\"): PathStyle {
  const unify = (path: string) => (separator === "\\" ? path.replace(/\//g, "\\") : path);
  const collapse = (path: string) => {
    const unc = separator === "\\" && path.startsWith("\\\\");
    const collapsed = path.replace(separator === "\\" ? /\\+/g : /\/+/g, separator);
    return unc ? separator + collapsed : collapsed;
  };
  const isRoot = (path: string) => path === separator || /^[A-Za-z]:\\?$/.test(path);

  const normalize = (path: string) => {
    const unified = collapse(unify(path));
    if (isRoot(unified)) return /^[A-Za-z]:$/.test(unified) ? unified + separator : unified;
    return unified.endsWith(separator) ? unified.slice(0, -1) : unified;
  };

  return {
    separator,
    normalize,
    join: (...parts) => normalize(parts.filter(Boolean).join(separator)),
    dirname(path) {
      const normalized = normalize(path);
      const cut = normalized.lastIndexOf(separator);
      if (cut < 0) return ".";
      const parent = normalized.slice(0, cut);
      return parent === "" ? separator : /^[A-Za-z]:$/.test(parent) ? parent + separator : parent;
    },
  };
}

export const posixPaths: PathStyle = style("/");
export const windowsPaths: PathStyle = style("\\");
