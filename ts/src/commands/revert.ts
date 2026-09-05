import { deriveChanges } from "../changes.js";
import { requireContributor } from "../config.js";
import { SnapError } from "../errors.js";
import { installTree } from "../install.js";
import type { Output } from "../presentation.js";
import type { Patch } from "../repository.js";
import { replay, requireKnownVersion } from "../replay.js";
import {
  MAX_REVISION,
  formatVersion,
  parseVersion,
  revisionOf,
  withRevision,
} from "../version.js";
import { isClean } from "../worktree.js";
import { locateWorkspace, readRepository, scanWorkingTree, writeRepository } from "../workspace.js";

/**
 * SPEC.md §7.7. Diffs the current tree to the target tree and authors one new
 * patch, so revert is additive: it never removes patches or moves the frontier
 * backward. Prints the new version, not the target.
 *
 * The unknown-version check precedes the contributor requirement, which is
 * what test 14 pins: reverting to an unknown version in a repository with no
 * contributor configured must report the version, not the missing identity.
 */
export function revert(
  cwd: string,
  env: Readonly<Record<string, string | undefined>>,
  versionText: string,
): Output {
  const workspace = locateWorkspace(cwd);
  const repository = readRepository(workspace);

  const target = parseVersion(versionText);
  requireKnownVersion(repository, target);

  const author = requireContributor(workspace, env);

  const current = replay(repository, repository.frontier);
  const working = scanWorkingTree(workspace.root);
  if (!isClean(current, working)) throw new SnapError("working tree is dirty");

  const targetTree = replay(repository, target);
  const changes = deriveChanges(current, targetTree);
  if (changes.length === 0) throw new SnapError("target tree is already current");

  const revision = revisionOf(repository.frontier, author) + 1;
  if (revision > MAX_REVISION) throw new SnapError("revision overflow for " + author);

  // Generated revert messages may exceed the 4096-byte limit that applies to
  // user-supplied ones, because they contain a complete version (§4.2).
  const patch: Patch = {
    author,
    revision,
    base: repository.frontier,
    message: "revert to " + formatVersion(target),
    changes,
  };

  const frontier = withRevision(repository.frontier, author, revision);
  installTree(workspace.root, current, targetTree);
  writeRepository(workspace, { frontier, patches: [...repository.patches, patch] });

  return { kind: "success", label: "Reverted", version: formatVersion(frontier) };
}
