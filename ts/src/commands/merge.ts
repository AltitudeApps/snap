import { SnapError } from "../errors.js";
import { installTree } from "../install.js";
import type { Output } from "../presentation.js";
import {
  dotOf,
  serializeRepository,
  type Patch,
  type Repository,
} from "../repository.js";
import { readOperandRepository } from "../http.js";
import { replayDetailed, type Warning } from "../replay.js";
import { compareBytes } from "../bytes.js";
import { formatVersion, join } from "../version.js";
import { isClean } from "../worktree.js";
import { validateRepository } from "../validate.js";
import {
  locateWorkspace,
  readRepository,
  scanWorkingTree,
  writeRepository,
} from "../workspace.js";

/**
 * §3.5 and §4.2. Patches sharing a dot are duplicates only when their parsed
 * typed values are structurally equal; different values at one dot are
 * corruption, and merge must fail before writing anything.
 */
function samePatch(left: Patch, right: Patch): boolean {
  return serializePatch(left) === serializePatch(right);
}

function serializePatch(patch: Patch): string {
  return serializeRepository({ frontier: new Map(), patches: [patch] });
}

/**
 * §3.5. Every dot present in both repositories must carry structurally equal
 * patches. A differing value at one dot is corruption, not a merge conflict,
 * and Snap cannot repair it automatically.
 */
export function requireCompatibleHistories(local: Repository, other: Repository): void {
  const byDot = new Map<string, Patch>();
  for (const patch of local.patches) byDot.set(dotOf(patch), patch);
  for (const patch of other.patches) {
    const existing = byDot.get(dotOf(patch));
    if (existing !== undefined && !samePatch(existing, patch)) {
      throw new SnapError(
        "patch collision: " + patch.author + " revision " + String(patch.revision),
      );
    }
  }
}

export function unionPatches(local: Repository, other: Repository): Patch[] {
  requireCompatibleHistories(local, other);
  const byDot = new Map<string, Patch>();
  for (const patch of local.patches) byDot.set(dotOf(patch), patch);
  for (const patch of other.patches) {
    if (!byDot.has(dotOf(patch))) byDot.set(dotOf(patch), patch);
  }
  return [...byDot.values()].sort(
    (left, right) =>
      compareBytes(left.author, right.author) || left.revision - right.revision,
  );
}

function warningKey(warning: Warning): string {
  return warning.path + " " + warning.reason;
}

/**
 * SPEC.md §7.8. Requires a clean working tree but no contributor. Unions the
 * patch sets, joins the frontiers, replays canonically, installs the result,
 * and creates no patch. Only warnings absent from the pre-merge local replay
 * are printed (§6.4).
 */
export async function merge(
  cwd: string,
  operand: string,
): Promise<{ output: Output; warnings: string[] }> {
  const workspace = locateWorkspace(cwd);
  const local = readRepository(workspace);
  const other = await readOperandRepository(cwd, operand);

  const before = replayDetailed(local, local.frontier);
  const working = scanWorkingTree(workspace.root);
  if (!isClean(before.tree, working)) throw new SnapError("working tree is dirty");

  const merged: Repository = {
    frontier: join(local.frontier, other.frontier),
    patches: unionPatches(local, other),
  };
  // Everything is parsed, validated and replayed before anything is written
  // (§10), so a failure here leaves the repository untouched.
  validateRepository(merged);
  const after = replayDetailed(merged, merged.frontier);

  installTree(workspace.root, before.tree, after.tree);
  writeRepository(workspace, merged);

  const known = new Set(before.warnings.map(warningKey));
  const warnings = after.warnings
    .filter((warning) => !known.has(warningKey(warning)))
    .map((warning) => "auto-resolved " + warning.path + ": " + warning.reason);

  return {
    output: { kind: "success", label: "Merged", version: formatVersion(merged.frontier) },
    warnings,
  };
}
