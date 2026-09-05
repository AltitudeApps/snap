import { decodeUtf8, encodeUtf8 } from "./bytes.js";
import { SnapError } from "./errors.js";

/**
 * SPEC.md §4.4. A file is text when its bytes are valid UTF-8 and contain no
 * NUL. Tokens are produced by splitting immediately after every LF byte, with
 * the LF retained, so the empty file has no tokens.
 */
export function asText(bytes: Uint8Array): string | undefined {
  if (bytes.includes(0)) return undefined;
  return decodeUtf8(bytes);
}

export function isText(bytes: Uint8Array): boolean {
  return asText(bytes) !== undefined;
}

export function tokenize(content: string): string[] {
  const tokens: string[] = [];
  let start = 0;
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "\n") {
      tokens.push(content.slice(start, index + 1));
      start = index + 1;
    }
  }
  if (start < content.length) tokens.push(content.slice(start));
  return tokens;
}

export function detokenize(tokens: readonly string[]): Uint8Array {
  return encodeUtf8(tokens.join(""));
}

/** §4.4 edit-script operations. Each object carries exactly one key. */
export type EditOperation =
  | { readonly retain: number }
  | { readonly delete: number }
  | { readonly insert: readonly string[] };

export type EditScript = readonly EditOperation[];

export function isRetain(op: EditOperation): op is { readonly retain: number } {
  return "retain" in op;
}

export function isDelete(op: EditOperation): op is { readonly delete: number } {
  return "delete" in op;
}

export function isInsert(op: EditOperation): op is { readonly insert: readonly string[] } {
  return "insert" in op;
}

/**
 * Builds a script while merging adjacent operations of the same kind, which
 * §4.4 forbids from appearing separately.
 */
export class EditBuilder {
  private readonly operations: EditOperation[] = [];

  retain(count: number): void {
    if (count <= 0) return;
    const last = this.operations[this.operations.length - 1];
    if (last !== undefined && isRetain(last)) {
      this.operations[this.operations.length - 1] = { retain: last.retain + count };
      return;
    }
    this.operations.push({ retain: count });
  }

  delete(count: number): void {
    if (count <= 0) return;
    const last = this.operations[this.operations.length - 1];
    if (last !== undefined && isDelete(last)) {
      this.operations[this.operations.length - 1] = { delete: last.delete + count };
      return;
    }
    this.operations.push({ delete: count });
  }

  insert(tokens: readonly string[]): void {
    if (tokens.length === 0) return;
    const last = this.operations[this.operations.length - 1];
    if (last !== undefined && isInsert(last)) {
      this.operations[this.operations.length - 1] = { insert: [...last.insert, ...tokens] };
      return;
    }
    this.operations.push({ insert: [...tokens] });
  }

  build(): EditScript {
    return this.operations;
  }
}

/**
 * §5. The canonical token diff. `D(i, j)` is the minimum number of inserts and
 * deletes transforming `A[i..]` into `B[j..]`; the walk prefers `delete` on a
 * tie, which is what makes repeated lines diff identically everywhere.
 */
export function diffTokens(oldTokens: readonly string[], newTokens: readonly string[]): EditScript {
  const n = oldTokens.length;
  const m = newTokens.length;

  // distance[i][j] = D(i, j), filled from the exhausted-side boundaries back.
  const distance: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n; i >= 0; i -= 1) {
    for (let j = m; j >= 0; j -= 1) {
      if (i === n && j === m) distance[i]![j] = 0;
      else if (j === m) distance[i]![j] = n - i;
      else if (i === n) distance[i]![j] = m - j;
      else if (oldTokens[i] === newTokens[j]) distance[i]![j] = distance[i + 1]![j + 1]!;
      else distance[i]![j] = 1 + Math.min(distance[i + 1]![j]!, distance[i]![j + 1]!);
    }
  }

  const builder = new EditBuilder();
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && oldTokens[i] === newTokens[j]) {
      builder.retain(1);
      i += 1;
      j += 1;
    } else if (j === m || (i < n && distance[i + 1]![j]! <= distance[i]![j + 1]!)) {
      builder.delete(1);
      i += 1;
    } else {
      builder.insert([newTokens[j] as string]);
      j += 1;
    }
  }
  return builder.build();
}

/**
 * Applies a script, enforcing §4.4: the script must consume the complete old
 * token sequence, and the result must be a canonical token sequence.
 */
export function applyEdit(oldTokens: readonly string[], script: EditScript): string[] {
  const result: string[] = [];
  let index = 0;
  for (const operation of script) {
    if (isRetain(operation)) {
      if (index + operation.retain > oldTokens.length) {
        throw new SnapError("edit script consumes beyond old content");
      }
      for (let step = 0; step < operation.retain; step += 1) {
        result.push(oldTokens[index] as string);
        index += 1;
      }
    } else if (isDelete(operation)) {
      if (index + operation.delete > oldTokens.length) {
        throw new SnapError("edit script consumes beyond old content");
      }
      index += operation.delete;
    } else {
      result.push(...operation.insert);
    }
  }
  if (index !== oldTokens.length) {
    throw new SnapError("edit script does not consume old content");
  }
  requireCanonicalTokens(result);
  return result;
}

/**
 * §4.4: every token except possibly the final one ends in LF, and no token
 * contains LF before its final byte.
 */
export function requireCanonicalTokens(tokens: readonly string[]): void {
  tokens.forEach((token, index) => {
    if (token.length === 0) throw new SnapError("edit script insert is empty");
    const newline = token.indexOf("\n");
    if (newline >= 0 && newline !== token.length - 1) {
      throw new SnapError("edit script produces a noncanonical token");
    }
    const isFinal = index === tokens.length - 1;
    if (!isFinal && !token.endsWith("\n")) {
      throw new SnapError("edit script produces a noncanonical token");
    }
  });
}
