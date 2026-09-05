import { compareBytes, encodeUtf8 } from "./bytes.js";
import { SnapError } from "./errors.js";
import {
  asArray,
  asObject,
  asPositiveInteger,
  asString,
  field,
  isJsonArray,
  parseJson,
  requireFields,
  type JsonValue,
} from "./json.js";
import {
  isDelete,
  isInsert,
  isRetain,
  type EditOperation,
  type EditScript,
} from "./text.js";
import { requirePath } from "./tree.js";
import {
  components,
  isValidContributorId,
  makeVersion,
  withRevision,
  type Version,
} from "./version.js";

export const FORMAT = 1;
export const MAX_MESSAGE_BYTES = 4096;

export interface TextChange {
  readonly type: "text";
  readonly path: string;
  readonly edit: EditScript;
}

export interface PutChange {
  readonly type: "put";
  readonly path: string;
  readonly content: Uint8Array;
}

export interface DeleteChange {
  readonly type: "delete";
  readonly path: string;
}

export type Change = TextChange | PutChange | DeleteChange;

export interface Patch {
  readonly author: string;
  readonly revision: number;
  readonly base: Version;
  readonly message: string;
  readonly changes: readonly Change[];
}

export interface Repository {
  readonly frontier: Version;
  readonly patches: readonly Patch[];
}

export function patchResult(patch: Patch): Version {
  return withRevision(patch.base, patch.author, patch.revision);
}

export function dotOf(patch: Patch): string {
  return patch.author + "->" + String(patch.revision);
}

/**
 * §4.2. `message` is a nonempty UTF-8 string that may contain tab and LF but
 * no other ASCII control character.
 */
export function isValidMessage(message: string): boolean {
  if (message.length === 0) return false;
  for (const character of message) {
    const code = character.codePointAt(0) as number;
    if (code === 0x09 || code === 0x0a) continue;
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

function parseVersionValue(value: JsonValue, what: string): Version {
  const pairs = asArray(value, what);
  const entries: [string, number][] = [];
  let previousId: string | undefined;
  for (const pair of pairs) {
    const parts = asArray(pair, what + " component");
    if (parts.length !== 2) throw new SnapError(what + " component must be a pair");
    const id = asString(parts[0] as JsonValue, what + " contributor");
    if (!isValidContributorId(id)) {
      throw new SnapError("invalid contributor id: " + id);
    }
    const revision = asPositiveInteger(parts[1] as JsonValue, what + " revision");
    if (previousId !== undefined && compareBytes(previousId, id) >= 0) {
      throw new SnapError(what + " is not in canonical order");
    }
    previousId = id;
    entries.push([id, revision]);
  }
  return makeVersion(entries);
}

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function parseBase64(text: string): Uint8Array {
  if (!BASE64_PATTERN.test(text)) throw new SnapError("content is not canonical base64");
  return new Uint8Array(Buffer.from(text, "base64"));
}

function parseEditOperation(value: JsonValue): EditOperation {
  const object = asObject(value, "edit operation");
  if (object.entries.size !== 1) {
    throw new SnapError("edit operation must have one operation");
  }
  const [key] = [...object.entries.keys()];
  const inner = object.entries.get(key as string) as JsonValue;
  if (key === "retain") return { retain: asPositiveInteger(inner, "retain") };
  if (key === "delete") return { delete: asPositiveInteger(inner, "delete") };
  if (key === "insert") {
    const tokens = asArray(inner, "insert").map((token) => asString(token, "insert token"));
    if (tokens.length === 0) throw new SnapError("edit script insert is empty");
    return { insert: tokens };
  }
  throw new SnapError("edit operation must have one operation");
}

function parseEditScript(value: JsonValue): EditScript {
  const script = asArray(value, "edit").map(parseEditOperation);
  for (let index = 1; index < script.length; index += 1) {
    const previous = script[index - 1] as EditOperation;
    const current = script[index] as EditOperation;
    const kind =
      isRetain(previous) && isRetain(current)
        ? "retain"
        : isDelete(previous) && isDelete(current)
          ? "delete"
          : isInsert(previous) && isInsert(current)
            ? "insert"
            : undefined;
    if (kind !== undefined) {
      throw new SnapError("edit script has adjacent " + kind + " operations");
    }
  }
  return script;
}

function parseChange(value: JsonValue): Change {
  const object = asObject(value, "change");
  const type = asString(field(object, "type", "change"), "change type");
  const path = requirePath(asString(field(object, "path", "change"), "change path"));
  switch (type) {
    case "text":
      requireFields(object, ["type", "path", "edit"], "text change");
      return { type: "text", path, edit: parseEditScript(field(object, "edit", "text change")) };
    case "put":
      requireFields(object, ["type", "path", "content"], "put change");
      return {
        type: "put",
        path,
        content: parseBase64(asString(field(object, "content", "put change"), "content")),
      };
    case "delete":
      requireFields(object, ["type", "path"], "delete change");
      return { type: "delete", path };
    default:
      throw new SnapError("unknown change type: " + type);
  }
}

function parsePatch(value: JsonValue): Patch {
  const object = asObject(value, "patch");
  requireFields(object, ["author", "revision", "base", "message", "changes"], "patch");
  const author = asString(field(object, "author", "patch"), "patch author");
  if (!isValidContributorId(author)) {
    throw new SnapError("invalid contributor id: " + author);
  }
  const revision = asPositiveInteger(field(object, "revision", "patch"), "patch revision");
  const base = parseVersionValue(field(object, "base", "patch"), "patch base");
  const message = asString(field(object, "message", "patch"), "patch message");
  if (message.length === 0) throw new SnapError("patch message is empty");
  if (!isValidMessage(message)) throw new SnapError("invalid patch message");

  const changes = asArray(field(object, "changes", "patch"), "patch changes").map(parseChange);
  if (changes.length === 0) throw new SnapError("patch changes is empty");
  let previousPath: string | undefined;
  for (const change of changes) {
    if (previousPath !== undefined && compareBytes(previousPath, change.path) >= 0) {
      throw new SnapError("patch changes are not in canonical path order");
    }
    previousPath = change.path;
  }
  return { author, revision, base, message, changes };
}

export function parseRepository(text: string): Repository {
  const root = asObject(parseJson(text), "repository");
  requireFields(root, ["format", "frontier", "patches"], "repository");
  const format = field(root, "format", "repository");
  if (asPositiveInteger(format, "repository format") !== FORMAT) {
    throw new SnapError("unsupported repository format");
  }
  const frontier = parseVersionValue(field(root, "frontier", "repository"), "frontier");
  const patchesValue = field(root, "patches", "repository");
  if (!isJsonArray(patchesValue)) throw new SnapError("repository patches must be an array");
  const patches = patchesValue.map(parsePatch);
  return { frontier, patches };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

function versionToJson(version: Version): unknown[] {
  return components(version).map(([id, revision]) => [id, revision]);
}

function changeToJson(change: Change): unknown {
  switch (change.type) {
    case "text":
      return { type: "text", path: change.path, edit: change.edit };
    case "put":
      return {
        type: "put",
        path: change.path,
        content: Buffer.from(change.content).toString("base64"),
      };
    case "delete":
      return { type: "delete", path: change.path };
  }
}

/**
 * §4.1. Patches are sorted by author and then numeric revision; writers use
 * two-space indentation and a trailing LF.
 */
export function serializeRepository(repository: Repository): string {
  const patches = [...repository.patches].sort(
    (left, right) =>
      compareBytes(left.author, right.author) || left.revision - right.revision,
  );
  const value = {
    format: FORMAT,
    frontier: versionToJson(repository.frontier),
    patches: patches.map((patch) => ({
      author: patch.author,
      revision: patch.revision,
      base: versionToJson(patch.base),
      message: patch.message,
      changes: patch.changes.map(changeToJson),
    })),
  };
  return JSON.stringify(value, null, 2) + "\n";
}

export function messageByteLength(message: string): number {
  return encodeUtf8(message).length;
}
