import { SnapError } from "./errors.js";

/**
 * A strict JSON reader. `JSON.parse` is unusable here because it silently
 * keeps the last of duplicate keys (§4.1 requires unique keys) and erases the
 * distinction between an integer and a number written with a fraction or
 * exponent (§4.1 makes non-integer numbers an error).
 */
export type JsonValue =
  | null
  | boolean
  | string
  | JsonNumber
  | readonly JsonValue[]
  | JsonObject;

/** A number retains its source spelling so integrality can be judged exactly. */
export interface JsonNumber {
  readonly kind: "number";
  readonly value: number;
  readonly source: string;
}

export interface JsonObject {
  readonly kind: "object";
  readonly entries: ReadonlyMap<string, JsonValue>;
}

export function isJsonNumber(value: JsonValue): value is JsonNumber {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "number";
}

export function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "object";
}

export function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function fail(detail: string): never {
  throw new SnapError("invalid JSON: " + detail);
}

const WHITESPACE = new Set([" ", "\t", "\n", "\r"]);

class Reader {
  private index = 0;

  constructor(private readonly text: string) {}

  parse(): JsonValue {
    this.skipWhitespace();
    const value = this.readValue();
    this.skipWhitespace();
    if (this.index !== this.text.length) fail("trailing content");
    return value;
  }

  private peek(): string | undefined {
    return this.text[this.index];
  }

  private skipWhitespace(): void {
    while (this.index < this.text.length) {
      const character = this.text[this.index] as string;
      if (!WHITESPACE.has(character)) break;
      this.index += 1;
    }
  }

  private expect(character: string): void {
    if (this.text[this.index] !== character) fail("expected " + character);
    this.index += 1;
  }

  private readValue(): JsonValue {
    const character = this.peek();
    if (character === undefined) fail("unexpected end of input");
    switch (character) {
      case "{":
        return this.readObject();
      case "[":
        return this.readArray();
      case '"':
        return this.readString();
      default:
        break;
    }
    if (this.text.startsWith("true", this.index)) {
      this.index += 4;
      return true;
    }
    if (this.text.startsWith("false", this.index)) {
      this.index += 5;
      return false;
    }
    if (this.text.startsWith("null", this.index)) {
      this.index += 4;
      return null;
    }
    return this.readNumber();
  }

  private readObject(): JsonObject {
    this.expect("{");
    const entries = new Map<string, JsonValue>();
    this.skipWhitespace();
    if (this.peek() === "}") {
      this.index += 1;
      return { kind: "object", entries };
    }
    for (;;) {
      this.skipWhitespace();
      const key = this.readString();
      if (entries.has(key)) throw new SnapError("duplicate JSON key " + key);
      this.skipWhitespace();
      this.expect(":");
      this.skipWhitespace();
      entries.set(key, this.readValue());
      this.skipWhitespace();
      const next = this.peek();
      if (next === ",") {
        this.index += 1;
        continue;
      }
      if (next === "}") {
        this.index += 1;
        return { kind: "object", entries };
      }
      fail("expected , or } in object");
    }
  }

  private readArray(): JsonValue[] {
    this.expect("[");
    const items: JsonValue[] = [];
    this.skipWhitespace();
    if (this.peek() === "]") {
      this.index += 1;
      return items;
    }
    for (;;) {
      this.skipWhitespace();
      items.push(this.readValue());
      this.skipWhitespace();
      const next = this.peek();
      if (next === ",") {
        this.index += 1;
        continue;
      }
      if (next === "]") {
        this.index += 1;
        return items;
      }
      fail("expected , or ] in array");
    }
  }

  private readString(): string {
    this.expect('"');
    let text = "";
    for (;;) {
      const character = this.text[this.index];
      if (character === undefined) fail("unterminated string");
      this.index += 1;
      if (character === '"') return text;
      if (character !== "\\") {
        if (character.charCodeAt(0) < 0x20) fail("control character in string");
        text += character;
        continue;
      }
      const escape = this.text[this.index];
      if (escape === undefined) fail("unterminated escape");
      this.index += 1;
      switch (escape) {
        case '"':
        case "\\":
        case "/":
          text += escape;
          break;
        case "b":
          text += "\b";
          break;
        case "f":
          text += "\f";
          break;
        case "n":
          text += "\n";
          break;
        case "r":
          text += "\r";
          break;
        case "t":
          text += "\t";
          break;
        case "u": {
          const digits = this.text.slice(this.index, this.index + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(digits)) fail("invalid unicode escape");
          this.index += 4;
          text += String.fromCharCode(Number.parseInt(digits, 16));
          break;
        }
        default:
          fail("invalid escape");
      }
    }
  }

  private readNumber(): JsonNumber {
    const start = this.index;
    if (this.peek() === "-") this.index += 1;
    const digitsStart = this.index;
    while (/[0-9]/.test(this.text[this.index] ?? "")) this.index += 1;
    if (this.index === digitsStart) fail("expected a number");
    const integer = this.text.slice(digitsStart, this.index);
    if (integer.length > 1 && integer.startsWith("0")) fail("leading zero in number");
    if (this.peek() === ".") {
      this.index += 1;
      const fractionStart = this.index;
      while (/[0-9]/.test(this.text[this.index] ?? "")) this.index += 1;
      if (this.index === fractionStart) fail("expected a fraction");
    }
    const exponent = this.peek();
    if (exponent === "e" || exponent === "E") {
      this.index += 1;
      const sign = this.peek();
      if (sign === "+" || sign === "-") this.index += 1;
      const exponentStart = this.index;
      while (/[0-9]/.test(this.text[this.index] ?? "")) this.index += 1;
      if (this.index === exponentStart) fail("expected an exponent");
    }
    const source = this.text.slice(start, this.index);
    return { kind: "number", value: Number(source), source };
  }
}

export function parseJson(text: string): JsonValue {
  return new Reader(text).parse();
}

/**
 * A JSON number is an integer only when it is spelled as one. `1.0` and `1e2`
 * are rejected even though their values are integral, because §4.1 makes
 * non-integer numbers an error and the spelling is the only evidence.
 */
export function asInteger(value: JsonValue, what: string): number {
  if (!isJsonNumber(value)) throw new SnapError(what + " must be an integer");
  if (!/^-?(?:0|[1-9][0-9]*)$/.test(value.source)) {
    throw new SnapError(what + " must be an integer");
  }
  if (!Number.isSafeInteger(value.value)) {
    throw new SnapError(what + " must be a positive safe integer");
  }
  return value.value;
}

export function asPositiveInteger(value: JsonValue, what: string): number {
  const integer = asInteger(value, what);
  if (integer <= 0) throw new SnapError(what + " must be a positive safe integer");
  return integer;
}

export function asString(value: JsonValue, what: string): string {
  if (typeof value !== "string") throw new SnapError(what + " must be a string");
  return value;
}

export function asArray(value: JsonValue, what: string): readonly JsonValue[] {
  if (!isJsonArray(value)) throw new SnapError(what + " must be an array");
  return value;
}

export function asObject(value: JsonValue, what: string): JsonObject {
  if (!isJsonObject(value)) throw new SnapError(what + " must be an object");
  return value;
}

/** Unknown fields are errors (§4.1), so every reader declares what it accepts. */
export function requireFields(
  object: JsonObject,
  known: readonly string[],
  what: string,
): void {
  for (const key of object.entries.keys()) {
    if (!known.includes(key)) {
      throw new SnapError(what + " has unknown field: " + key);
    }
  }
}

export function field(object: JsonObject, name: string, what: string): JsonValue {
  const value = object.entries.get(name);
  if (value === undefined) throw new SnapError(what + " is missing field: " + name);
  return value;
}
