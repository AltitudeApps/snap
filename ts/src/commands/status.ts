import type { Output } from "../presentation.js";
import { replay } from "../replay.js";
import { formatVersion } from "../version.js";
import { treeChanges } from "../worktree.js";
import { locateWorkspace, readRepository, scanWorkingTree } from "../workspace.js";

/** SPEC.md §7.3. Prints the current version and working changes sorted by path. */
export function status(cwd: string): Output {
  const workspace = locateWorkspace(cwd);
  const repository = readRepository(workspace);
  const current = replay(repository, repository.frontier);
  const working = scanWorkingTree(workspace.root);
  return {
    kind: "status",
    version: formatVersion(repository.frontier),
    entries: treeChanges(current, working),
  };
}
