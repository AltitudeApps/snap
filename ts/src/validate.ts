import { bytesEqual, compareBytes } from "./bytes.js";
import { SnapError } from "./errors.js";
import { dotOf, type Change, type Patch, type Repository } from "./repository.js";
import { applyChange, orderPatches, replay } from "./replay.js";
import { requirePrefixFree } from "./tree.js";
import { revisionOf } from "./version.js";

/**
 * SPEC.md §4.5. Everything a repository must satisfy before Snap will use it.
 * Validation is the only door into the in-memory model, so no command can act
 * on a repository that has not been through here (§10).
 */
export function validateRepository(repository: Repository): void {
  requireCanonicalPatchOrder(repository.patches);
  requireOneValuePerDot(repository.patches);
  requireContiguousRevisions(repository);
  requireBaseTransitions(repository);
  requireClosure(repository);
  requireChangesAgainstBase(repository);
  requirePrefixFree(replay(repository, repository.frontier).keys());
}

/** §4.1: patches are sorted by author and then numeric revision. */
function requireCanonicalPatchOrder(patches: readonly Patch[]): void {
  for (let index = 1; index < patches.length; index += 1) {
    const previous = patches[index - 1] as Patch;
    const current = patches[index] as Patch;
    const order =
      compareBytes(previous.author, current.author) || previous.revision - current.revision;
    if (order >= 0) {
      throw new SnapError("patches are not in canonical order");
    }
  }
}

/**
 * §3.5 and §4.2. One patch owns exactly one dot; the same dot carrying
 * structurally different patches is corruption, not a merge conflict.
 */
function requireOneValuePerDot(patches: readonly Patch[]): void {
  const seen = new Set<string>();
  for (const patch of patches) {
    const dot = dotOf(patch);
    if (seen.has(dot)) throw new SnapError("duplicate patch for dot " + dot);
    seen.add(dot);
  }
}

/** §3.5. For each contributor, revision `n` exists and follows `n - 1`. */
function requireContiguousRevisions(repository: Repository): void {
  const highest = new Map<string, number>();
  for (const patch of repository.patches) {
    highest.set(patch.author, Math.max(highest.get(patch.author) ?? 0, patch.revision));
  }
  for (const [author, top] of highest) {
    const present = new Set(
      repository.patches.filter((patch) => patch.author === author).map((patch) => patch.revision),
    );
    for (let revision = 1; revision <= top; revision += 1) {
      if (!present.has(revision)) {
        throw new SnapError(
          "patch history is missing " + author + "->" + String(revision),
        );
      }
    }
  }
  for (const [author, revision] of repository.frontier) {
    if ((highest.get(author) ?? 0) < revision) {
      throw new SnapError("patch history is missing " + author + "->" + String(revision));
    }
  }
}

/** §4.2: `revision = base[author] + 1`, so one patch increments one component. */
function requireBaseTransitions(repository: Repository): void {
  for (const patch of repository.patches) {
    if (patch.revision !== revisionOf(patch.base, patch.author) + 1) {
      throw new SnapError("patch " + dotOf(patch) + " does not follow its base");
    }
  }
}

/**
 * §4.1. `patches` contains exactly the causal closure of `frontier`: every
 * patch's base is present, and no patch is unreachable from the frontier.
 */
function requireClosure(repository: Repository): void {
  const dots = new Set(repository.patches.map(dotOf));
  for (const patch of repository.patches) {
    if (patch.revision > revisionOf(repository.frontier, patch.author)) {
      throw new SnapError("unreachable patch: " + dotOf(patch));
    }
    for (const [author, revision] of patch.base) {
      for (let step = 1; step <= revision; step += 1) {
        if (!dots.has(author + "->" + String(step))) {
          throw new SnapError("patch history is missing " + author + "->" + String(step));
        }
      }
    }
  }
}

/**
 * §4.5 item 5 and §4.3. Every change is checked against its patch's exact
 * materialized base: a create needs the path absent, an edit, replacement or
 * delete needs it present, and no change may leave existence and bytes alone.
 * Ordering the patches first also proves causality is acyclic (§4.5 item 4).
 */
function requireChangesAgainstBase(repository: Repository): void {
  for (const patch of orderPatches(repository.patches)) {
    const base = replay(repository, patch.base);
    for (const change of patch.changes) {
      requireChangeAgainstBase(base, change);
    }
  }
}

function requireChangeAgainstBase(base: ReadonlyMap<string, Uint8Array>, change: Change): void {
  const before = base.get(change.path);

  if (change.type === "delete") {
    if (before === undefined) {
      throw new SnapError("delete of absent path: " + change.path);
    }
    return;
  }

  const working = new Map(base);
  applyChange(working, change);
  const after = working.get(change.path);
  if (after === undefined) throw new SnapError("no-op change at " + change.path);

  // An empty text edit may create an empty file; every other change must
  // alter path existence or bytes.
  if (before !== undefined && bytesEqual(before, after)) {
    throw new SnapError("no-op change at " + change.path);
  }
}
