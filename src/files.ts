import { readdirSync, statSync, lstatSync } from "node:fs";
import type { Skipped } from "./types.js";
import { basename, extname, join, relative, resolve, sep } from "node:path";

export type FileKind = "js" | "python" | "terraform" | "template";

export interface SourceFile {
  abs: string;
  /** Path relative to the root, always with forward slashes. */
  rel: string;
  kind: FileKind;
}

/** Directories that never contain project source. */
export const DEFAULT_IGNORED_DIRS = [
  "node_modules",
  ".git",
  "dist",
  ".venv",
  "venv",
  "__pycache__",
  ".terraform",
  "site-packages",
  ".tox",
  ".mypy_cache",
  ".pytest_cache",
];

const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Raised for input the user can fix, such as a path that does not exist. */
export class UsageError extends Error {
  override name = "UsageError";
  constructor(
    message: string,
    /** Message key suffix (`error.<code>`) the CLI uses to print the error in the chosen language. */
    readonly code: string = "usage",
    readonly params: Record<string, string | number> = {},
  ) {
    super(message);
  }
}

function classify(file: string): FileKind | undefined {
  const name = basename(file);
  if (name.endsWith(".d.ts") || name.endsWith(".d.mts") || name.endsWith(".d.cts")) return undefined;
  switch (extname(name)) {
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
    case ".ts":
    case ".tsx":
    case ".mts":
    case ".cts":
      return "js";
    case ".py":
      return "python";
    case ".tf":
      return "terraform";
    case ".yaml":
    case ".yml":
    case ".json":
    case ".template":
      return "template";
    default:
      return undefined;
  }
}

/** Walk the given files and directories and return supported files in a stable sorted order. */
export function collectFiles(paths: string[], root: string, ignore: string[] = [], skipped: Skipped[] = []): SourceFile[] {
  const ignored = new Set([...DEFAULT_IGNORED_DIRS, ...ignore]);
  const found = new Map<string, SourceFile>();
  const base = resolve(root);

  const add = (abs: string): void => {
    const kind = classify(abs);
    if (!kind) return;
    const rel = relative(base, abs).split(sep).join("/");
    let size: number;
    try {
      size = statSync(abs).size;
    } catch {
      skipped.push({ file: rel, reason: "unreadable" });
      return;
    }
    if (size > MAX_FILE_BYTES) {
      skipped.push({ file: rel, reason: "too-large" });
      return;
    }
    found.set(abs, { abs, rel, kind });
  };

  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      skipped.push({ file: relative(base, dir).split(sep).join("/") || ".", reason: "unreadable" });
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) walk(abs);
      } else if (entry.isFile()) {
        add(abs);
      }
    }
  };

  for (const input of paths) {
    const abs = resolve(base, input);
    let stat;
    try {
      stat = lstatSync(abs);
    } catch {
      throw new UsageError(
        `Path not found: ${input}. Pass an existing file or directory, for example "emucheck check .".`,
        "path-not-found",
        { path: input },
      );
    }
    if (stat.isDirectory()) walk(abs);
    else add(abs);
  }
  return [...found.values()].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}
