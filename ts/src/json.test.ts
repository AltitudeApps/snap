import assert from "node:assert/strict";
import { test } from "node:test";

import { SnapError } from "./errors.js";
import { asPositiveInteger, isJsonObject, parseJson } from "./json.js";

/**
 * Regressions for the strict reader. `.snap/repository.json` may arrive over
 * HTTP from a source Snap does not control (§9), so malformed input must
 * always be an expected failure that exits 1 (§10) — never a native throw,
 * which main.ts reports as an internal failure and exits 2.
 */

test("deep nesting fails as an expected error, not a stack overflow", () => {
  for (const depth of [5_000, 200_000]) {
    const text = "[".repeat(depth) + "]".repeat(depth);
    assert.throws(
      () => parseJson(text),
      (error: unknown) => error instanceof SnapError,
      "depth " + String(depth) + " must raise SnapError",
    );
  }
  // Nesting a repository actually needs still parses.
  assert.ok(isJsonObject(parseJson('{"a":[{"b":[{"c":["d"]}]}]}')));
});

test("duplicate object keys are rejected rather than last-wins", () => {
  assert.throws(
    () => parseJson('{"format":1,"format":2}'),
    (error: unknown) => error instanceof SnapError && error.message.includes("duplicate JSON key"),
  );
});

test("integrality is judged by spelling, not by value", () => {
  // Recorded as a deliberate reading of §4.1: the suite pins neither.
  for (const source of ["1.0", "1e2", "1E2", "0.5"]) {
    assert.throws(
      () => asPositiveInteger(parseJson(source), "revision"),
      (error: unknown) =>
        error instanceof SnapError && error.message.includes("positive safe integer"),
      source + " must be rejected",
    );
  }
  assert.equal(asPositiveInteger(parseJson("42"), "revision"), 42);
});

test("revisions beyond the safe-integer cap are rejected", () => {
  assert.equal(asPositiveInteger(parseJson("9007199254740991"), "revision"), 9007199254740991);
  for (const source of ["9007199254740992", "-5", "0"]) {
    assert.throws(
      () => asPositiveInteger(parseJson(source), "revision"),
      (error: unknown) => error instanceof SnapError,
      source + " must be rejected",
    );
  }
});

test("the JSON number grammar is followed exactly", () => {
  for (const source of ["-0", "0", "1e+5", "1E-5", "-1.5"]) {
    assert.doesNotThrow(() => parseJson(source), source + " is valid JSON");
  }
  for (const source of ["00", "01", "1.", ".5", "1e", "-", "+1"]) {
    assert.throws(() => parseJson(source), SnapError, source + " is not valid JSON");
  }
});

test("astral characters survive a surrogate pair escape", () => {
  const value = parseJson('"\\ud83d\\ude00"');
  assert.equal(value, "\u{1f600}");
  assert.equal([...(value as string)].length, 1);
});

test("structural errors are rejected", () => {
  for (const source of ['{"a":1,}', "[1,]", '{"a" 1}', '{"a":1', "[1", '{"a":1} trailing']) {
    assert.throws(() => parseJson(source), SnapError, source + " must be rejected");
  }
});
