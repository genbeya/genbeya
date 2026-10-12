/**
 * Which untracked files .gitignore files exclude, as Git reads them: rules
 * of deeper files and later lines win, `!` takes a file back, a trailing
 * slash matches folders only, a slash elsewhere anchors a rule to its
 * file's folder, and a file in an ignored folder stays ignored.
 */
import { parentOf } from "../../utilities/repository-path";

interface Rule {
  /** The folder of the .gitignore; "" for the root. */
  readonly folder: string;
  readonly pattern: RegExp;
  readonly negated: boolean;
  readonly folderOnly: boolean;
}

/** A glob of gitignore syntax as a regular expression over a path relative to its folder. */
function globToRegExp(glob: string, anchored: boolean): RegExp {
  let source = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]!;
    if (char === "\\" && i + 1 < glob.length) source += escape(glob[++i]!);
    else if (char === "*" && glob[i + 1] === "*") {
      // "**/" matches any folders, "/**" anything below, a lone "**" anything.
      if (glob[i + 2] === "/") {
        source += "(?:.*/)?";
        i += 2;
      } else {
        source += ".*";
        i++;
      }
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else if (char === "[") {
      const close = glob.indexOf("]", i + 2);
      if (close < 0) source += "\\[";
      else {
        const body = glob
          .slice(i + 1, close)
          .replace(/^!/, "^")
          .replace(/\\/g, "\\\\");
        source += `[${body}]`;
        i = close;
      }
    } else source += escape(char);
  }
  return new RegExp(anchored ? `^${source}$` : `^(?:.*/)?${source}$`);
}

const escape = (char: string) => char.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** The rules of one .gitignore in `folder`. */
function parse(folder: string, content: string): Rule[] {
  const rules: Rule[] = [];
  for (const raw of content.split("\n")) {
    let line = raw.replace(/\r$/, "");
    // Trailing spaces go unless escaped.
    line = line.replace(/(?<!\\)\s+$/, "");
    if (!line || line.startsWith("#")) continue;
    const negated = line.startsWith("!");
    if (negated || line.startsWith("\\!") || line.startsWith("\\#")) line = line.slice(1);
    const folderOnly = line.endsWith("/");
    if (folderOnly) line = line.slice(0, -1);
    // A slash at the start or in the middle anchors the rule to the folder of its file.
    const anchored = line.includes("/");
    if (line.startsWith("/")) line = line.slice(1);
    if (!line) continue;
    rules.push({ folder, pattern: globToRegExp(line, anchored), negated, folderOnly });
  }
  return rules;
}

export class IgnoreRules {
  private readonly rules: Rule[];

  /** From the .gitignore files of a working tree, by path. */
  constructor(files: ReadonlyMap<string, string>) {
    const ignoreFiles = [...files].filter(([path]) => path === ".gitignore" || path.endsWith("/.gitignore"));
    // Shallower files first, so the rules of deeper ones come later and win.
    ignoreFiles.sort(([a], [b]) => a.split("/").length - b.split("/").length);
    this.rules = ignoreFiles.flatMap(([path, content]) => parse(parentOf(path), content));
  }

  /** Whether `path`, a file, or a folder on its way, is ignored. */
  ignores(path: string): boolean {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) if (this.matches(parts.slice(0, i).join("/"), true)) return true;
    return this.matches(path, false);
  }

  private matches(path: string, folder: boolean): boolean {
    let ignored = false;
    for (const rule of this.rules) {
      if (rule.folderOnly && !folder) continue;
      if (rule.folder && !path.startsWith(`${rule.folder}/`)) continue;
      const relative = rule.folder ? path.slice(rule.folder.length + 1) : path;
      if (rule.pattern.test(relative)) ignored = !rule.negated;
    }
    return ignored;
  }
}
