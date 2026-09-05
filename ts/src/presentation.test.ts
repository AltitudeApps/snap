import assert from "node:assert/strict";
import { test } from "node:test";

import { SnapError } from "./errors.js";
import { resolvePresentation } from "./presentation.js";

/**
 * SPEC.md §11 requires these cases as unit tests: the shared harness captures
 * candidate streams through pipes and provides no portable PTY operation, so
 * it cannot exercise `auto` when a stream is a TTY.
 */

const streams = (stdout: boolean, stderr: boolean) => ({
  stdoutIsTty: stdout,
  stderrIsTty: stderr,
});

test("auto selects terminal mode per stream, independently", () => {
  assert.deepEqual(resolvePresentation({}, streams(true, true)), {
    stdout: "terminal",
    stderr: "terminal",
  });
  assert.deepEqual(resolvePresentation({}, streams(false, false)), {
    stdout: "plain",
    stderr: "plain",
  });
  // The two streams are decided separately, not together.
  assert.deepEqual(resolvePresentation({}, streams(true, false)), {
    stdout: "terminal",
    stderr: "plain",
  });
  assert.deepEqual(resolvePresentation({}, streams(false, true)), {
    stdout: "plain",
    stderr: "terminal",
  });
});

test("an explicit auto behaves exactly like an unset SNAP_COLOR", () => {
  for (const [stdout, stderr] of [
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ] as const) {
    assert.deepEqual(
      resolvePresentation({ SNAP_COLOR: "auto" }, streams(stdout, stderr)),
      resolvePresentation({}, streams(stdout, stderr)),
    );
  }
});

test("NO_COLOR selects the complete plain presentation in auto mode", () => {
  // Its presence is what counts, including an empty value.
  for (const value of ["1", ""]) {
    assert.deepEqual(resolvePresentation({ NO_COLOR: value }, streams(true, true)), {
      stdout: "plain",
      stderr: "plain",
    });
  }
});

test("SNAP_COLOR=always overrides NO_COLOR and ignores TTY state", () => {
  assert.deepEqual(
    resolvePresentation({ SNAP_COLOR: "always", NO_COLOR: "1" }, streams(false, false)),
    { stdout: "terminal", stderr: "terminal" },
  );
});

test("SNAP_COLOR=never is plain even on a TTY", () => {
  assert.deepEqual(resolvePresentation({ SNAP_COLOR: "never" }, streams(true, true)), {
    stdout: "plain",
    stderr: "plain",
  });
});

test("any other SNAP_COLOR value is an error before command execution", () => {
  assert.throws(
    () => resolvePresentation({ SNAP_COLOR: "sometimes" }, streams(false, false)),
    (error: unknown) =>
      error instanceof SnapError &&
      error.message === "SNAP_COLOR must be auto, always, or never",
  );
});
