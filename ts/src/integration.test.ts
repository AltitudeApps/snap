import assert from "node:assert/strict";
import { test } from "node:test";

import { encodeUtf8 } from "./bytes.js";
import { replayDetailed } from "./replay.js";
import type { Repository } from "./repository.js";
import { validateRepository } from "./validate.js";
import { EMPTY_VERSION, makeVersion } from "./version.js";

/**
 * SPEC.md §6.2 rule 3 applies OT only when `B`, `C` and `T` are all text and
 * the incoming change `P` is a text change. The packaged suite never varies
 * `B`'s text-ness, so PLAN.md §7 recorded the binary-`B` case as an open
 * question. These tests establish that the question is vacuous rather than
 * merely untested: the branch cannot be reached, so the guard on `B` is not
 * load-bearing and no choice about it is observable.
 *
 * They also pin the reachable combinations, which the suite exercises only
 * through the filesystem.
 */

const BINARY = new Uint8Array([0x00, 0xff]);
const text = (value: string): Uint8Array => encodeUtf8(value);

const SEED = makeVersion([["seed@x", 1]]);

function outcome(repository: Repository): { content: string | undefined; warnings: string } {
  validateRepository(repository);
  const { tree, warnings } = replayDetailed(repository, repository.frontier);
  const bytes = tree.get("f");
  return {
    content: bytes === undefined ? undefined : Buffer.from(bytes).toString("base64"),
    warnings: warnings.map((warning) => warning.path + ":" + warning.reason).join(","),
  };
}

test("a text change cannot have a binary base, so rule 3's B guard is unreachable", () => {
  // Authored by hand: `commit` would never produce this, because it emits a
  // put whenever the old bytes are not text.
  const repository: Repository = {
    frontier: makeVersion([["a@x", 2]]),
    patches: [
      {
        author: "a@x",
        revision: 1,
        base: EMPTY_VERSION,
        message: "binary",
        changes: [{ type: "put", path: "f", content: BINARY }],
      },
      {
        author: "a@x",
        revision: 2,
        base: makeVersion([["a@x", 1]]),
        message: "text over binary",
        changes: [{ type: "text", path: "f", edit: [{ insert: ["x\n"] }] }],
      },
    ],
  };
  assert.throws(
    () => validateRepository(repository),
    /text change applied to non-text path/,
    "§4.5 must reject a text edit whose exact base is not text",
  );
});

test("a binary base with two concurrent text puts resolves by rule 5, not by B", () => {
  // B is binary while C and T are both text. Rule 3 fails on `P` being a put
  // before B's text-ness is consulted, so §6.4 rule 5 decides.
  const repository: Repository = {
    frontier: makeVersion([
      ["a@x", 1],
      ["b@x", 1],
      ["seed@x", 1],
    ]),
    patches: [
      {
        author: "a@x",
        revision: 1,
        base: SEED,
        message: "alice",
        changes: [{ type: "put", path: "f", content: text("alice\n") }],
      },
      {
        author: "b@x",
        revision: 1,
        base: SEED,
        message: "bob",
        changes: [{ type: "put", path: "f", content: text("bob\n") }],
      },
      {
        author: "seed@x",
        revision: 1,
        base: EMPTY_VERSION,
        message: "seed",
        changes: [{ type: "put", path: "f", content: BINARY }],
      },
    ],
  };
  // alice@x integrates last under Snap order, so its put is the later one.
  assert.deepEqual(outcome(repository), {
    content: Buffer.from(text("alice\n")).toString("base64"),
    warnings: "f:later-put-wins",
  });
});

test("a text change over a text base whose current content went binary yields put-wins", () => {
  const repository: Repository = {
    frontier: makeVersion([
      ["a@x", 1],
      ["b@x", 1],
      ["seed@x", 1],
    ]),
    patches: [
      {
        author: "a@x",
        revision: 1,
        base: SEED,
        message: "alice edits text",
        changes: [{ type: "text", path: "f", edit: [{ delete: 1 }, { insert: ["alice\n"] }] }],
      },
      {
        author: "b@x",
        revision: 1,
        base: SEED,
        message: "bob replaces with binary",
        changes: [{ type: "put", path: "f", content: BINARY }],
      },
      {
        author: "seed@x",
        revision: 1,
        base: EMPTY_VERSION,
        message: "seed",
        changes: [{ type: "text", path: "f", edit: [{ insert: ["seed\n"] }] }],
      },
    ],
  };
  // §6.4 rule 6: P is text and C is non-text, so the current content wins.
  assert.deepEqual(outcome(repository), {
    content: Buffer.from(BINARY).toString("base64"),
    warnings: "f:put-wins",
  });
});
