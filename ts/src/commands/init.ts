import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { SnapError } from "../errors.js";
import type { Output } from "../presentation.js";
import { EMPTY_VERSION } from "../version.js";
import { METADATA_DIRECTORY } from "../tree.js";
import { isRepositoryRoot, writeRepository } from "../workspace.js";

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

  for (let ancestor = dirname(target); ; ancestor = dirname(ancestor)) {
    if (isRepositoryRoot(ancestor)) {
      throw new SnapError("cannot initialize inside repository " + ancestor);
    }
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
  }

  mkdirSync(resolve(target, METADATA_DIRECTORY), { recursive: true });
  writeRepository({ root: target }, { frontier: EMPTY_VERSION, patches: [] });

  return { kind: "success", label: "Initialized repository", version: "()" };
}
