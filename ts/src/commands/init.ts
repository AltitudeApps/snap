import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { SnapError } from "../errors.js";
import type { Output } from "../presentation.js";

export const METADATA_DIRECTORY = ".snap";
export const REPOSITORY_FILE = "repository.json";
export const FORMAT = 1;

/** The empty repository value written by init (§4.1). */
const EMPTY_REPOSITORY = { format: FORMAT, frontier: [], patches: [] };

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isRepositoryRoot(path: string): boolean {
  return isDirectory(resolve(path, METADATA_DIRECTORY));
}

/**
 * Serialize a repository value: two-space indentation and a trailing LF, so
 * repositories stay pleasant to inspect (§4.1).
 */
export function serializeRepository(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

/**
 * SPEC.md §7.1. The target is created if absent, existing working files are
 * left uncommitted, and both reinitialization and initialization beneath an
 * existing repository are errors.
 */
export function init(cwd: string, pathArgument: string): Output {
  const target = resolve(cwd, pathArgument);

  if (isRepositoryRoot(target)) {
    throw new SnapError("repository already exists");
  }

  for (
    let ancestor = dirname(target);
    ;
    ancestor = dirname(ancestor)
  ) {
    if (isRepositoryRoot(ancestor)) {
      throw new SnapError("cannot initialize inside repository " + ancestor);
    }
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
  }

  const metadata = resolve(target, METADATA_DIRECTORY);
  mkdirSync(metadata, { recursive: true });
  writeFileSync(
    resolve(metadata, REPOSITORY_FILE),
    serializeRepository(EMPTY_REPOSITORY),
  );

  return { kind: "success", label: "Initialized repository", version: "()" };
}
