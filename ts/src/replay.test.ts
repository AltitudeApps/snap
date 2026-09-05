import assert from "node:assert/strict";
import { test } from "node:test";

import { encodeUtf8 } from "./bytes.js";
import { deriveChanges } from "./changes.js";
import { unionPatches } from "./commands/merge.js";
import { replayDetailed, type Warning } from "./replay.js";
import type { Repository } from "./repository.js";
import type { Tree } from "./tree.js";
import { validateRepository } from "./validate.js";
import { EMPTY_VERSION, formatVersion, join, revisionOf, withRevision } from "./version.js";

/**
 * SPEC.md §11: property tests over valid causal patch graphs, verifying that
 * import permutations produce the same joined frontier, patch set, warnings
 * and tree. This also exercises §1's import laws directly — idempotence,
 * commutativity and associativity — and §6.5's guarantee that merge direction
 * cannot change the joined result.
 */

/** A small deterministic PRNG, so a failure is always reproducible. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const EMPTY: Repository = { frontier: EMPTY_VERSION, patches: [] };

/** Records a tree as one patch, the way commit does, keeping the history valid. */
function commit(repository: Repository, author: string, next: Tree): Repository {
  const current = replayDetailed(repository, repository.frontier).tree;
  const changes = deriveChanges(current, next);
  if (changes.length === 0) return repository;
  const revision = revisionOf(repository.frontier, author) + 1;
  return {
    frontier: withRevision(repository.frontier, author, revision),
    patches: [
      ...repository.patches,
      { author, revision, base: repository.frontier, message: "m", changes },
    ],
  };
}

function importFrom(local: Repository, other: Repository): Repository {
  return {
    frontier: join(local.frontier, other.frontier),
    patches: unionPatches(local, other),
  };
}

function tree(entries: Record<string, string>): Tree {
  return new Map(Object.entries(entries).map(([path, text]) => [path, encodeUtf8(text)]));
}

function describe(repository: Repository): string {
  const { tree: result, warnings } = replayDetailed(repository, repository.frontier);
  const files = [...result.entries()]
    .map(([path, bytes]) => path + "=" + Buffer.from(bytes).toString("base64"))
    .sort()
    .join("|");
  const reasons = warnings.map((w: Warning) => w.path + ":" + w.reason).join(",");
  return formatVersion(repository.frontier) + " [" + files + "] {" + reasons + "}";
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  const result: T[][] = [];
  items.forEach((item, index) => {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    for (const tail of permutations(rest)) result.push([item, ...tail]);
  });
  return result;
}

const PATHS = ["a", "b", "dir/c", "dir/d"];
const LINES = ["alpha\n", "beta\n", "gamma\n", "delta\n"];

function randomTree(random: () => number, base: Tree): Tree {
  const next = new Map(base);
  for (const path of PATHS) {
    const roll = random();
    if (roll < 0.3) next.delete(path);
    else if (roll < 0.8) {
      const count = 1 + Math.floor(random() * 3);
      let text = "";
      for (let line = 0; line < count; line += 1) {
        text += LINES[Math.floor(random() * LINES.length)] as string;
      }
      next.set(path, encodeUtf8(text));
    }
  }
  // Keep the tree prefix-free: `dir/...` and a file named `dir` cannot coexist.
  if ([...next.keys()].some((path) => path.startsWith("dir/"))) next.delete("dir");
  return next;
}

test("import permutations converge on one frontier, tree and warning set", () => {
  const random = makeRandom(20260905);

  for (let round = 0; round < 60; round += 1) {
    const seeded = commit(EMPTY, "seed@x", randomTree(random, new Map()));
    const seedTree = replayDetailed(seeded, seeded.frontier).tree;

    // Three concurrent branches from one common base.
    const branches = ["alice@x", "bob@x", "carol@x"].map((author) =>
      commit(seeded, author, randomTree(random, seedTree)),
    );

    const expected = permutations(branches).map((order) => {
      let merged = seeded;
      for (const branch of order) merged = importFrom(merged, branch);
      validateRepository(merged);
      return describe(merged);
    });

    const first = expected[0] as string;
    for (const outcome of expected) {
      assert.equal(outcome, first, "import order changed the joined result");
    }
  }
});

test("import is idempotent and commutative", () => {
  const random = makeRandom(4242);

  for (let round = 0; round < 40; round += 1) {
    const seeded = commit(EMPTY, "seed@x", randomTree(random, new Map()));
    const seedTree = replayDetailed(seeded, seeded.frontier).tree;
    const left = commit(seeded, "alice@x", randomTree(random, seedTree));
    const right = commit(seeded, "bob@x", randomTree(random, seedTree));

    const forward = importFrom(left, right);
    const backward = importFrom(right, left);
    assert.equal(describe(forward), describe(backward), "merge direction changed the result");

    // Re-merging the same history is a no-op.
    assert.equal(describe(importFrom(forward, right)), describe(forward));
    assert.equal(describe(importFrom(forward, forward)), describe(forward));
  }
});

test("import is associative", () => {
  const random = makeRandom(97531);

  for (let round = 0; round < 40; round += 1) {
    const seeded = commit(EMPTY, "seed@x", randomTree(random, new Map()));
    const seedTree = replayDetailed(seeded, seeded.frontier).tree;
    const [a, b, c] = ["a@x", "b@x", "c@x"].map((author) =>
      commit(seeded, author, randomTree(random, seedTree)),
    ) as [Repository, Repository, Repository];

    const leftFirst = importFrom(importFrom(a, b), c);
    const rightFirst = importFrom(a, importFrom(b, c));
    assert.equal(describe(leftFirst), describe(rightFirst), "association changed the result");
  }
});

test("a generated history is always valid and reproducible from its patches", () => {
  const random = makeRandom(13579);
  const seeded = commit(EMPTY, "seed@x", tree({ a: "one\n", "dir/c": "two\n" }));
  const seedTree = replayDetailed(seeded, seeded.frontier).tree;
  const merged = importFrom(
    commit(seeded, "alice@x", randomTree(random, seedTree)),
    commit(seeded, "bob@x", randomTree(random, seedTree)),
  );
  validateRepository(merged);
  assert.equal(describe(merged), describe(merged));
});
