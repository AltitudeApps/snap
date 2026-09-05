import { compareBytes, encodeUtf8 } from "./bytes.js";
import { SnapError } from "./errors.js";

/**
 * SPEC.md §3. A version is a vector clock: a finite map from contributor ID
 * to a positive revision. Zero means "no revision" and is never stored, so a
 * version has exactly one representation.
 */
export type Version = ReadonlyMap<string, number>;

export const EMPTY_VERSION: Version = new Map();

/** §3.1: revisions are positive integers no greater than this. */
export const MAX_REVISION = Number.MAX_SAFE_INTEGER;

const MAX_ID_BYTES = 254;

/**
 * §3.1. An ASCII email-shaped string: exactly one `@` with nonempty text on
 * both sides, no control character, whitespace, `,`, `(`, `)`, or `->`, and
 * at most 254 bytes.
 */
export function isValidContributorId(id: string): boolean {
  if (encodeUtf8(id).length > MAX_ID_BYTES) return false;
  const at = id.indexOf("@");
  if (at <= 0 || at !== id.lastIndexOf("@") || at === id.length - 1) return false;
  if (id.includes("->")) return false;
  for (const character of id) {
    const code = character.codePointAt(0) as number;
    // Printable ASCII only; this excludes control characters and whitespace.
    if (code <= 0x20 || code >= 0x7f) return false;
    if (character === "," || character === "(" || character === ")") return false;
  }
  return true;
}

export function requireContributorId(id: string): string {
  if (!isValidContributorId(id)) {
    throw new SnapError("invalid contributor id: " + id);
  }
  return id;
}

/** A version's components in canonical order: contributor ID by UTF-8 bytes. */
export function components(version: Version): readonly (readonly [string, number])[] {
  return [...version.entries()].sort((left, right) => compareBytes(left[0], right[0]));
}

export function revisionOf(version: Version, id: string): number {
  return version.get(id) ?? 0;
}

/** Drops zero components so equal versions have equal maps. */
export function makeVersion(entries: Iterable<readonly [string, number]>): Version {
  const version = new Map<string, number>();
  for (const [id, revision] of entries) {
    if (revision !== 0) version.set(id, revision);
  }
  return version;
}

export function withRevision(version: Version, id: string, revision: number): Version {
  const next = new Map(version);
  if (revision === 0) next.delete(id);
  else next.set(id, revision);
  return next;
}

export function formatVersion(version: Version): string {
  const body = components(version)
    .map(([id, revision]) => id + "->" + String(revision))
    .join(",");
  return "(" + body + ")";
}

const REVISION_PATTERN = /^[1-9][0-9]*$/;

function invalidVersion(text: string): never {
  throw new SnapError("invalid version: " + text);
}

/**
 * §3.2. CLI arguments must use the exact canonical form. Duplicate IDs,
 * explicit zeroes, leading zeroes, overflow, invalid IDs, whitespace, and
 * noncanonical ordering are all errors.
 */
export function parseVersion(text: string): Version {
  if (!text.startsWith("(") || !text.endsWith(")")) invalidVersion(text);
  const body = text.slice(1, -1);
  if (body.length === 0) return EMPTY_VERSION;

  const version = new Map<string, number>();
  let previousId: string | undefined;
  for (const component of body.split(",")) {
    const arrow = component.indexOf("->");
    if (arrow < 0) invalidVersion(text);
    const id = component.slice(0, arrow);
    const digits = component.slice(arrow + 2);
    if (!isValidContributorId(id)) invalidVersion(text);
    if (!REVISION_PATTERN.test(digits)) invalidVersion(text);
    const revision = Number(digits);
    if (!Number.isSafeInteger(revision)) invalidVersion(text);
    if (version.has(id)) invalidVersion(text);
    if (previousId !== undefined && compareBytes(previousId, id) >= 0) invalidVersion(text);
    previousId = id;
    version.set(id, revision);
  }
  return version;
}

export type Ordering = "equal" | "before" | "after" | "concurrent";

function contributors(left: Version, right: Version): Set<string> {
  return new Set([...left.keys(), ...right.keys()]);
}

/** §3.3. All four outcomes are preserved; concurrency is not before or after. */
export function compareVersions(left: Version, right: Version): Ordering {
  let leftSmaller = false;
  let rightSmaller = false;
  for (const id of contributors(left, right)) {
    const a = revisionOf(left, id);
    const b = revisionOf(right, id);
    if (a < b) leftSmaller = true;
    else if (a > b) rightSmaller = true;
  }
  if (leftSmaller && rightSmaller) return "concurrent";
  if (leftSmaller) return "before";
  if (rightSmaller) return "after";
  return "equal";
}

export function join(left: Version, right: Version): Version {
  const joined = new Map(left);
  for (const [id, revision] of right) {
    if (revision > (joined.get(id) ?? 0)) joined.set(id, revision);
  }
  return joined;
}

/**
 * §3.4. An arbitrary total order used only to integrate concurrent patches:
 * over the sorted union of contributor IDs, the first unequal counter decides.
 * It extends causal order but carries no chronological meaning.
 */
export function compareSnapOrder(left: Version, right: Version): number {
  const ids = [...contributors(left, right)].sort(compareBytes);
  for (const id of ids) {
    const a = revisionOf(left, id);
    const b = revisionOf(right, id);
    if (a !== b) return a < b ? -1 : 1;
  }
  return 0;
}
