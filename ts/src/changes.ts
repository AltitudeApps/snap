import { bytesEqual, compareBytes } from "./bytes.js";
import type { Change } from "./repository.js";
import { asText, diffTokens, tokenize } from "./text.js";
import type { Tree } from "./tree.js";

/**
 * SPEC.md §7.5. Uses a text change when the new content is text and the old
 * path is absent or text; otherwise `put`. Removed paths use `delete`.
 * Paths whose existence and bytes are unchanged produce no change at all.
 */
export function deriveChanges(from: Tree, to: Tree): Change[] {
  const paths = new Set<string>([...from.keys(), ...to.keys()]);
  const changes: Change[] = [];

  for (const path of [...paths].sort(compareBytes)) {
    const before = from.get(path);
    const after = to.get(path);

    if (after === undefined) {
      if (before !== undefined) changes.push({ type: "delete", path });
      continue;
    }
    if (before !== undefined && bytesEqual(before, after)) continue;

    const newText = asText(after);
    const oldText = before === undefined ? "" : asText(before);
    if (newText === undefined || oldText === undefined) {
      changes.push({ type: "put", path, content: after });
      continue;
    }
    changes.push({
      type: "text",
      path,
      edit: diffTokens(tokenize(oldText), tokenize(newText)),
    });
  }
  return changes;
}
