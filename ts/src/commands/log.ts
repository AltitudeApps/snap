import type { LogEntry, Output } from "../presentation.js";
import { orderPatches, patchResult, selectPatches } from "../repository.js";
import { formatVersion } from "../version.js";
import { locateWorkspace, readRepository } from "../workspace.js";

/**
 * SPEC.md §7.4. In messages, backslash, tab, and LF are escaped as `\\`, `\t`
 * and `\n`, in that order.
 */
export function escapeMessage(message: string): string {
  return message.replaceAll("\\", "\\\\").replaceAll("\t", "\\t").replaceAll("\n", "\\n");
}

/** §7.4. Patches in reverse canonical integration order, one line each. */
export function log(cwd: string): Output {
  const workspace = locateWorkspace(cwd);
  const repository = readRepository(workspace);
  const ordered = orderPatches(selectPatches(repository, repository.frontier));
  const entries: LogEntry[] = ordered.reverse().map((patch) => ({
    version: formatVersion(patchResult(patch)),
    author: patch.author,
    message: escapeMessage(patch.message),
  }));
  return { kind: "log", entries };
}
