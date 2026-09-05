import { bytesEqual, compareBytes } from "./bytes.js";
import { SnapError } from "./errors.js";
import { transform } from "./ot.js";
import {
  dotOf,
  patchResult,
  type Change,
  type Patch,
  type Repository,
} from "./repository.js";
import {
  applyEdit,
  asText,
  detokenize,
  diffTokens,
  tokenize,
} from "./text.js";
import { isNamespaceConflict, requirePrefixFree, type Tree } from "./tree.js";
import {
  compareSnapOrder,
  formatVersion,
  revisionOf,
  type Version,
} from "./version.js";

/** §6.4 reasons, emitted once per path whose whole effect was discarded. */
export type Reason =
  | "delete-wins"
  | "later-create-wins"
  | "later-put-wins"
  | "namespace-wins"
  | "put-wins";

export interface Warning {
  readonly path: string;
  readonly reason: Reason;
}

export interface ReplayResult {
  readonly tree: Tree;
  readonly warnings: readonly Warning[];
}

type MutableTree = Map<string, Uint8Array>;

/** §4.1. The patches selected by a version: every `(c, n)` with `n <= V[c]`. */
export function selectPatches(repository: Repository, version: Version): Patch[] {
  return repository.patches.filter(
    (patch) => patch.revision <= revisionOf(version, patch.author),
  );
}

function isContainedBy(base: Version, integrated: ReadonlySet<string>): boolean {
  for (const [id, revision] of base) {
    for (let step = 1; step <= revision; step += 1) {
      if (!integrated.has(id + "->" + String(step))) return false;
    }
  }
  return true;
}

/**
 * SPEC.md §6.1. Repeatedly integrate the least ready patch, ordered by Snap
 * order of result version, then author bytes, then revision. This puts causal
 * dependencies before concurrent patches.
 */
export function orderPatches(patches: readonly Patch[]): Patch[] {
  const remaining = new Set(patches);
  const integrated = new Set<string>();
  const ordered: Patch[] = [];

  while (remaining.size > 0) {
    const ready = [...remaining].filter((patch) => isContainedBy(patch.base, integrated));
    if (ready.length === 0) throw new SnapError("cyclic or incomplete patch history");
    ready.sort(
      (left, right) =>
        compareSnapOrder(patchResult(left), patchResult(right)) ||
        compareBytes(left.author, right.author) ||
        left.revision - right.revision,
    );
    const next = ready[0] as Patch;
    remaining.delete(next);
    integrated.add(dotOf(next));
    ordered.push(next);
  }
  return ordered;
}

/** Applies one change to a tree exactly as authored, against that tree (§4.3). */
export function applyChange(tree: MutableTree, change: Change): void {
  switch (change.type) {
    case "delete": {
      if (!tree.has(change.path)) {
        throw new SnapError("delete of absent path: " + change.path);
      }
      tree.delete(change.path);
      return;
    }
    case "put": {
      tree.set(change.path, change.content);
      return;
    }
    case "text": {
      const existing = tree.get(change.path);
      const oldTokens =
        existing === undefined ? [] : tokenize(requireTextContent(existing, change.path));
      tree.set(change.path, detokenize(applyEdit(oldTokens, change.edit)));
      return;
    }
  }
}

function requireTextContent(bytes: Uint8Array, path: string): string {
  const text = asText(bytes);
  if (text === undefined) {
    throw new SnapError("text change applied to non-text path: " + path);
  }
  return text;
}

function sameContent(left: Uint8Array | undefined, right: Uint8Array | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return bytesEqual(left, right);
}

/**
 * §6.2. Integrates one patch into the canonical tree built so far.
 *
 * `B` is the patch's exact base tree, `C` the canonical tree so far — `B` plus
 * only earlier concurrent effects — and `T` the patch's authored result. All
 * paths are evaluated against the same `B` and `C`, and every resulting change
 * is applied together to form the next canonical tree.
 */
function integratePatch(
  base: Tree,
  current: Tree,
  patch: Patch,
  warnings: Warning[],
): MutableTree {
  const authored: MutableTree = new Map(base);
  for (const change of patch.changes) applyChange(authored, change);

  const result: MutableTree = new Map(current);

  // Namespace conflicts are resolved for the patch as a whole, first, and
  // their decisions override the per-path rules below.
  const madePresent = patch.changes
    .filter((change) => change.type !== "delete")
    .map((change) => change.path);
  const authoredDeletions = new Set(
    patch.changes.filter((change) => change.type === "delete").map((change) => change.path),
  );
  const settled = new Set<string>();
  const removals = new Set<string>();

  for (const incoming of madePresent) {
    for (const existing of current.keys()) {
      if (authoredDeletions.has(existing)) continue;
      if (!isNamespaceConflict(incoming, existing)) continue;
      removals.add(existing);
      settled.add(incoming);
      warnings.push({ path: existing, reason: "namespace-wins" });
    }
  }
  for (const path of removals) result.delete(path);
  for (const path of settled) {
    result.set(path, authored.get(path) as Uint8Array);
  }

  for (const change of patch.changes) {
    if (settled.has(change.path)) continue;
    resolvePath(base, current, authored, change, result, warnings);
  }
  return result;
}

function resolvePath(
  base: Tree,
  current: Tree,
  authored: Tree,
  change: Change,
  result: MutableTree,
  warnings: Warning[],
): void {
  const path = change.path;
  const b = base.get(path);
  const c = current.get(path);
  const t = authored.get(path);

  // 1. Identical in B and C: apply the authored change directly.
  if (sameContent(b, c)) {
    if (t === undefined) result.delete(path);
    else result.set(path, t);
    return;
  }

  // 2. Identical in C and T: keep it, collapsing identical concurrent changes
  //    before OT rather than duplicating their effect.
  if (sameContent(c, t)) return;

  // 3. All text, and the incoming change is a text change: transform through
  //    the aggregate context edit and apply to C.
  if (change.type === "text" && b !== undefined && c !== undefined && t !== undefined) {
    const baseText = asText(b);
    const currentText = asText(c);
    const authoredText = asText(t);
    if (baseText !== undefined && currentText !== undefined && authoredText !== undefined) {
      const currentTokens = tokenize(currentText);
      const context = diffTokens(tokenize(baseText), currentTokens);
      result.set(path, detokenize(applyEdit(currentTokens, transform(change.edit, context))));
      return;
    }
  }

  // 4. Otherwise the path-level rules decide.
  resolveByPathRules(b, c, t, change, path, result, warnings);
}

/** §6.4. Resolved strictly in this order; each discarded effect warns once. */
function resolveByPathRules(
  b: Uint8Array | undefined,
  c: Uint8Array | undefined,
  t: Uint8Array | undefined,
  change: Change,
  path: string,
  result: MutableTree,
  warnings: Warning[],
): void {
  // 1. C and T identical: keep C, no warning. (Reached only defensively; the
  //    caller already collapsed this case.)
  if (sameContent(c, t)) return;

  // 2. The incoming delete wins.
  if (t === undefined) {
    result.delete(path);
    warnings.push({ path, reason: "delete-wins" });
    return;
  }

  // 3. The earlier concurrent delete wins.
  if (b !== undefined && c === undefined) {
    result.delete(path);
    warnings.push({ path, reason: "delete-wins" });
    return;
  }

  // 4. The incoming, canonically later, create wins.
  if (b === undefined && c !== undefined) {
    result.set(path, t);
    warnings.push({ path, reason: "later-create-wins" });
    return;
  }

  // 5. The incoming atomic replacement wins.
  if (change.type === "put") {
    result.set(path, t);
    warnings.push({ path, reason: "later-put-wins" });
    return;
  }

  // 6. P is text and C is non-text: the incompatible current content wins.
  warnings.push({ path, reason: "put-wins" });
}

/** Unique pairs sorted by path, then reason (§6.4). */
function normalizeWarnings(warnings: readonly Warning[]): Warning[] {
  const unique = new Map<string, Warning>();
  for (const warning of warnings) {
    unique.set(warning.path + " " + warning.reason, warning);
  }
  return [...unique.values()].sort(
    (left, right) =>
      compareBytes(left.path, right.path) || compareBytes(left.reason, right.reason),
  );
}

/**
 * Replays a version by integrating its selected patches in canonical order.
 * Pure: it performs no validation, so validation itself can use it.
 */
export function replayDetailed(repository: Repository, version: Version): ReplayResult {
  const cache = new Map<string, Tree>();

  const materialize = (target: Version): Tree => {
    const key = formatVersion(target);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    let current: MutableTree = new Map();
    const collected: Warning[] = [];
    for (const patch of orderPatches(selectPatches(repository, target))) {
      current = integratePatch(materialize(patch.base), current, patch, collected);
    }
    cache.set(key, current);
    return current;
  };

  const warnings: Warning[] = [];
  let current: MutableTree = new Map();
  for (const patch of orderPatches(selectPatches(repository, version))) {
    current = integratePatch(materialize(patch.base), current, patch, warnings);
  }
  requirePrefixFree(current.keys());
  return { tree: current, warnings: normalizeWarnings(warnings) };
}

export function replay(repository: Repository, version: Version): Tree {
  return replayDetailed(repository, version).tree;
}

/**
 * §4.1. A version is known when every patch it selects exists and that set
 * contains the complete base of every selected patch.
 */
export function isKnownVersion(repository: Repository, version: Version): boolean {
  const selected = selectPatches(repository, version);
  const dots = new Set(selected.map(dotOf));
  for (const [id, revision] of version) {
    for (let step = 1; step <= revision; step += 1) {
      if (!dots.has(id + "->" + String(step))) return false;
    }
  }
  return selected.every((patch) => isContainedBy(patch.base, dots));
}

export function requireKnownVersion(repository: Repository, version: Version): void {
  if (!isKnownVersion(repository, version)) {
    throw new SnapError("unknown version: " + formatVersion(version));
  }
}
