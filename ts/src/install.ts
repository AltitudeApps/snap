import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { compareBytes } from "./bytes.js";
import { METADATA_DIRECTORY, type Tree } from "./tree.js";

function exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * SPEC.md §6.2. Installation removes files that block required directories,
 * creates required directories, writes target files, and removes newly empty
 * directories, so the filesystem represents exactly the target path/byte map.
 *
 * Callers must have scanned the working tree and found it clean first. That
 * scan is what rejects symlinks and other unsupported entries (§10), and this
 * function relies on it: `statSync` here would follow a link rather than
 * report it, and a file in neither `current` nor `target` would survive.
 */
export function installTree(root: string, current: Tree, target: Tree): void {
  for (const path of current.keys()) {
    if (!target.has(path)) rmSync(resolve(root, path), { force: true });
  }

  // Deterministic order for reproducible filesystem effects; pruning happens
  // once at the end, after every target file exists.
  for (const path of [...target.keys()].sort(compareBytes)) {
    const absolute = resolve(root, path);
    clearBlockingFiles(root, path);
    if (exists(absolute) && statSync(absolute).isDirectory()) {
      rmSync(absolute, { recursive: true, force: true });
    }
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, target.get(path) as Uint8Array);
  }

  pruneEmptyDirectories(root, root);
}

/**
 * A regular file standing where a target path needs a directory is removed,
 * which is how a file-to-directory transition materializes.
 */
function clearBlockingFiles(root: string, path: string): void {
  const segments = path.split("/");
  for (let count = 1; count < segments.length; count += 1) {
    const ancestor = resolve(root, segments.slice(0, count).join("/"));
    if (exists(ancestor) && !statSync(ancestor).isDirectory()) {
      rmSync(ancestor, { force: true });
    }
  }
}

/** Returns true when the directory is empty after pruning its children. */
function pruneEmptyDirectories(root: string, directory: string): boolean {
  let empty = true;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (directory === root && entry.name === METADATA_DIRECTORY) {
      empty = false;
      continue;
    }
    const child = join(directory, entry.name);
    if (!entry.isDirectory()) {
      empty = false;
      continue;
    }
    if (pruneEmptyDirectories(root, child)) rmSync(child, { recursive: true, force: true });
    else empty = false;
  }
  return empty && directory !== root;
}
