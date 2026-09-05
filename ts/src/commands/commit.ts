import { deriveChanges } from "../changes.js";
import { requireContributor } from "../config.js";
import { SnapError } from "../errors.js";
import type { Output } from "../presentation.js";
import {
  MAX_MESSAGE_BYTES,
  dotOf,
  isValidMessage,
  materialize,
  messageByteLength,
  type Patch,
} from "../repository.js";
import { requirePrefixFree } from "../tree.js";
import { MAX_REVISION, formatVersion, revisionOf, withRevision } from "../version.js";
import { locateWorkspace, readRepository, scanWorkingTree, writeRepository } from "../workspace.js";

/**
 * SPEC.md §7.5. Requires contributor configuration and a dirty working tree,
 * diffs the complete current tree against the complete working tree, and
 * creates one patch based on the current frontier.
 */
export function commit(
  cwd: string,
  env: Readonly<Record<string, string | undefined>>,
  message: string,
): Output {
  const workspace = locateWorkspace(cwd);
  const repository = readRepository(workspace);
  const author = requireContributor(workspace, env);

  if (!isValidMessage(message) || messageByteLength(message) > MAX_MESSAGE_BYTES) {
    throw new SnapError("invalid commit message");
  }

  const current = materialize(repository, repository.frontier);
  const working = scanWorkingTree(workspace.root);
  requirePrefixFree(working.keys());

  const changes = deriveChanges(current, working);
  if (changes.length === 0) throw new SnapError("working tree is clean");

  const revision = revisionOf(repository.frontier, author) + 1;
  if (revision > MAX_REVISION) throw new SnapError("revision overflow for " + author);

  const patch: Patch = {
    author,
    revision,
    base: repository.frontier,
    message,
    changes,
  };
  if (repository.patches.some((existing) => dotOf(existing) === dotOf(patch))) {
    throw new SnapError("dot collision for " + dotOf(patch));
  }

  const frontier = withRevision(repository.frontier, author, revision);
  // The desired working files are already present, so only the metadata is
  // replaced (§10).
  writeRepository(workspace, { frontier, patches: [...repository.patches, patch] });

  return { kind: "success", label: "Committed", version: formatVersion(frontier) };
}
