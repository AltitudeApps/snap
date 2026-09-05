/**
 * SPEC.md §2 and §3.2 order paths and contributor IDs by unsigned UTF-8
 * bytes. JavaScript's `<` compares UTF-16 code units, which disagrees for
 * astral characters, so every ordering in Snap goes through this module.
 */
const encoder = new TextEncoder();

export function compareBytes(left: string, right: string): number {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  const shared = Math.min(a.length, b.length);
  for (let index = 0; index < shared; index += 1) {
    const x = a[index] as number;
    const y = b[index] as number;
    if (x !== y) return x < y ? -1 : 1;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

export function sortByBytes<T>(items: Iterable<T>, key: (item: T) => string): T[] {
  return [...items].sort((left, right) => compareBytes(key(left), key(right)));
}

/** Strict UTF-8 decoding: invalid sequences throw rather than yielding U+FFFD. */
const strictDecoder = new TextDecoder("utf-8", { fatal: true });

export function decodeUtf8(bytes: Uint8Array): string | undefined {
  try {
    return strictDecoder.decode(bytes);
  } catch {
    return undefined;
  }
}

export function encodeUtf8(text: string): Uint8Array {
  return encoder.encode(text);
}

export function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
