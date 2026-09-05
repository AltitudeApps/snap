import { readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { SnapError } from "./errors.js";
import {
  parseRepository,
  serializeRepository,
  type Repository,
} from "./repository.js";
import { validateRepository } from "./validate.js";
import { METADATA_DIRECTORY, type Tree } from "./tree.js";

export const REPOSITORY_FILE = "repository.json";
export const CONFIG_FILE = "config.json";

export interface Workspace {
  /** Absolute path of the repository root, the parent of `.snap/`. */
  readonly root: string;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function isRepositoryRoot(path: string): boolean {
  return isDirectory(resolve(path, METADATA_DIRECTORY));
}

/** §7. Snap locates the nearest repository by walking to the filesystem root. */
export function locateWorkspace(from: string): Workspace {
  for (let directory = resolve(from); ; directory = dirname(directory)) {
    if (isRepositoryRoot(directory)) return { root: directory };
    const parent = dirname(directory);
    if (parent === directory) break;
  }
  throw new SnapError("not a Snap repository");
}

export function metadataPath(workspace: Workspace, name: string): string {
  return resolve(workspace.root, METADATA_DIRECTORY, name);
}

export function readRepository(workspace: Workspace): Repository {
  const path = metadataPath(workspace, REPOSITORY_FILE);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new SnapError("not a Snap repository");
  }
  const repository = parseRepository(text);
  validateRepository(repository);
  return repository;
}

/**
 * §10. `repository.json` is replaced through a same-directory temporary file,
 * so a reader never observes a partially written repository.
 */
export function writeRepository(workspace: Workspace, repository: Repository): void {
  const path = metadataPath(workspace, REPOSITORY_FILE);
  const temporary = path + ".tmp";
  writeFileSync(temporary, serializeRepository(repository));
  renameSync(temporary, path);
}

/**
 * §2. Snap tracks every regular file below the root except `.snap/`. Symlinks
 * and other non-regular entries are reported rather than followed (§10).
 */
export function scanWorkingTree(root: string): Tree {
  const tree = new Map<string, Uint8Array>();
  walk(root, "", tree);
  return tree;
}

function walk(root: string, prefix: string, tree: Map<string, Uint8Array>): void {
  const directory = prefix === "" ? root : join(root, prefix);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (prefix === "" && entry.name === METADATA_DIRECTORY) continue;
    const relative = prefix === "" ? entry.name : prefix + "/" + entry.name;
    if (entry.isDirectory()) {
      walk(root, relative, tree);
      continue;
    }
    if (!entry.isFile()) {
      throw new SnapError("unsupported working tree entry: " + relative);
    }
    tree.set(relative, new Uint8Array(readFileSync(join(root, relative))));
  }
}
