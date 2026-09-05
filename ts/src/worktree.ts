import { bytesEqual, compareBytes } from "./bytes.js";
import type { StatusEntry } from "./presentation.js";
import type { Tree } from "./tree.js";

/**
 * SPEC.md §7.3. `A` is absent-to-present, `M` is changed bytes, and `D` is
 * present-to-absent, sorted by path.
 */
export function treeChanges(current: Tree, working: Tree): StatusEntry[] {
  const paths = new Set<string>([...current.keys(), ...working.keys()]);
  const entries: StatusEntry[] = [];
  for (const path of [...paths].sort(compareBytes)) {
    const before = current.get(path);
    const after = working.get(path);
    if (before === undefined && after !== undefined) entries.push({ code: "A", path });
    else if (before !== undefined && after === undefined) entries.push({ code: "D", path });
    else if (before !== undefined && after !== undefined && !bytesEqual(before, after)) {
      entries.push({ code: "M", path });
    }
  }
  return entries;
}

/**
 * §2. The working tree is clean when its path/byte map exactly equals the
 * current tree. Unsupported entries are rejected during the scan itself.
 */
export function isClean(current: Tree, working: Tree): boolean {
  return treeChanges(current, working).length === 0;
}
