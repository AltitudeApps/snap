import { compareBytes } from "../bytes.js";
import type { DiffCompare } from "../cli.js";
import type { Output } from "../presentation.js";
import { replay, requireKnownVersion } from "../repository.js";
import { asText, diffTokens, isDelete, isInsert, isRetain, tokenize } from "../text.js";
import type { Tree } from "../tree.js";
import { parseVersion } from "../version.js";
import { locateWorkspace, readRepository, scanWorkingTree } from "../workspace.js";

const NO_NEWLINE = "\\ No newline at end of file";

/** An absent side is named `/dev/null` instead of `a/<path>` or `b/<path>`. */
function side(prefix: string, path: string, present: boolean): string {
  return present ? prefix + path : "/dev/null";
}

/**
 * SPEC.md §7.6. One whole-file unified-style block per changed text path, and
 * one line per changed binary path. A token without a final LF is followed by
 * the no-newline marker.
 */
function textBlock(path: string, oldText: string | undefined, newText: string | undefined): string[] {
  const oldTokens = oldText === undefined ? [] : tokenize(oldText);
  const newTokens = newText === undefined ? [] : tokenize(newText);
  const lines: string[] = [
    "--- " + side("a/", path, oldText !== undefined),
    "+++ " + side("b/", path, newText !== undefined),
    "@@ -1," + String(oldTokens.length) + " +1," + String(newTokens.length) + " @@",
  ];

  const emit = (prefix: string, token: string): void => {
    if (token.endsWith("\n")) {
      lines.push(prefix + token.slice(0, -1));
      return;
    }
    lines.push(prefix + token);
    lines.push(NO_NEWLINE);
  };

  let index = 0;
  for (const operation of diffTokens(oldTokens, newTokens)) {
    if (isRetain(operation)) {
      for (let step = 0; step < operation.retain; step += 1) {
        emit(" ", oldTokens[index] as string);
        index += 1;
      }
    } else if (isDelete(operation)) {
      for (let step = 0; step < operation.delete; step += 1) {
        emit("-", oldTokens[index] as string);
        index += 1;
      }
    } else {
      for (const token of operation.insert) emit("+", token);
    }
  }
  return lines;
}

export function renderTreeDiff(from: Tree, to: Tree): string[] {
  const paths = new Set<string>([...from.keys(), ...to.keys()]);
  const lines: string[] = [];

  for (const path of [...paths].sort(compareBytes)) {
    const before = from.get(path);
    const after = to.get(path);
    if (before !== undefined && after !== undefined && before.length === after.length) {
      let identical = true;
      for (let index = 0; index < before.length; index += 1) {
        if (before[index] !== after[index]) {
          identical = false;
          break;
        }
      }
      if (identical) continue;
    }

    const oldText = before === undefined ? undefined : asText(before);
    const newText = after === undefined ? undefined : asText(after);
    const oldIsBinary = before !== undefined && oldText === undefined;
    const newIsBinary = after !== undefined && newText === undefined;

    if (oldIsBinary || newIsBinary) {
      lines.push(
        "Binary files " +
          side("a/", path, before !== undefined) +
          " and " +
          side("b/", path, after !== undefined) +
          " differ",
      );
      continue;
    }
    lines.push(...textBlock(path, oldText, newText));
  }
  return lines;
}

/**
 * §7.6. With no arguments, compares the current tree with the working tree;
 * with two versions, compares two locally known versions.
 */
export function diff(cwd: string, compare: DiffCompare | undefined): Output {
  const workspace = locateWorkspace(cwd);
  const repository = readRepository(workspace);

  if (compare === undefined) {
    const current = replay(repository, repository.frontier);
    const working = scanWorkingTree(workspace.root);
    return { kind: "diff", lines: renderTreeDiff(current, working) };
  }

  const oldVersion = parseVersion(compare.old);
  const newVersion = parseVersion(compare.new);
  requireKnownVersion(repository, oldVersion);
  requireKnownVersion(repository, newVersion);

  return {
    kind: "diff",
    lines: renderTreeDiff(
      replay(repository, oldVersion),
      replay(repository, newVersion),
    ),
  };
}
