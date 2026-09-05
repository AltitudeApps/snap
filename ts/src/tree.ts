import { compareBytes } from "./bytes.js";
import { SnapError } from "./errors.js";

/** A materialized file tree: tracked path to exact bytes. */
export type Tree = ReadonlyMap<string, Uint8Array>;

export const METADATA_DIRECTORY = ".snap";

/**
 * SPEC.md §2. A tracked path is a UTF-8 relative path using `/` separators.
 * It must be nonempty, contain no ASCII control character or backslash,
 * contain no empty, `.` or `..` segment, and have no first segment equal to
 * `.snap`. No Unicode or case normalization is performed.
 */
export function isValidPath(path: string): boolean {
  if (path.length === 0) return false;
  if (path.includes("\\")) return false;
  for (const character of path) {
    const code = character.codePointAt(0) as number;
    if (code < 0x20 || code === 0x7f) return false;
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return false;
  }
  return segments[0] !== METADATA_DIRECTORY;
}

export function requirePath(path: string): string {
  if (!isValidPath(path)) throw new SnapError("invalid path: " + path);
  return path;
}

export function sortedPaths(tree: Tree): string[] {
  return [...tree.keys()].sort(compareBytes);
}

/**
 * §2. Every tracked tree is prefix-free by path segment: if `a` is a file, no
 * `a/...` path is present.
 */
export function requirePrefixFree(paths: Iterable<string>): void {
  const all = new Set(paths);
  for (const path of all) {
    const segments = path.split("/");
    for (let count = 1; count < segments.length; count += 1) {
      const ancestor = segments.slice(0, count).join("/");
      if (all.has(ancestor)) {
        throw new SnapError("path " + path + " conflicts with file " + ancestor);
      }
    }
  }
}

/** True when `path` is an ancestor or descendant of `other` by whole segments. */
export function isNamespaceConflict(path: string, other: string): boolean {
  if (path === other) return false;
  return path.startsWith(other + "/") || other.startsWith(path + "/");
}
