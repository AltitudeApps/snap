# Snap — implementation plan

Status: pre-implementation. `ts/src/main.ts` is a two-line stub.

This document records how the TypeScript edition will be built, why the
milestones are ordered the way they are, and which spec corners need a decision
before code is written. [`SPEC.md`](SPEC.md) remains the canonical contract; if
this plan and the spec ever disagree, the spec wins and this file is wrong.

## 1. What the assignment actually is

The deliverable is roughly 3,000–4,500 lines of strict TypeScript, graded by 28
language-neutral YAML cases under [`tests/`](tests/) that drive **304 CLI
invocations** with about **103 exact-byte stream assertions**.

**Scope: one language.** The workshop maintains reference implementations in
TypeScript, Rust and Scala so that the suite can be proven language-neutral, but
this archive ships a single attendee scaffold (`ts/`) and [`AGENTS.md`](AGENTS.md)
directs work at "the language directory present at the project root". §11's
cross-language exchange requirement is explicitly scoped to "maintainers with
all three reference implementations" and is not owed here. `run` and `verify`
accept `--lang rust|scala` because the launcher is shared, not as an obligation.

The useful reframe is that this is **not a version-control project, it is a
determinism project**. Familiar Git structure is absent by design (§12): no
object store, no hashes, no branches, no staging area, no merge commits. The
whole repository is a single `.snap/repository.json`. Every point of difficulty
is instead concentrated in producing exactly the specified bytes and exactly the
specified conflict decisions.

The compensation is that the spec deliberately removes algorithmic freedom:

- **§5** supplies the diff recurrence *and* its tie-break rule (choose `delete`
  when `D(i+1, j) <= D(i, j+1)`). Implement the recurrence literally rather than
  adopting a diff library; the naive O(n·m) dynamic program is comfortably fast
  at the sizes the suite uses. Myers or Hirschberg are permitted only if they
  reproduce the same script byte for byte, which is a risk with no payoff here.
- **§6.3** supplies the operational transform as a six-row table with an
  explicit priority row (`Q insert` outranks everything).
- **§6.1** supplies the exact replay order: Snap order of result versions, then
  unsigned UTF-8 order of author, then numeric revision.

So there is very little to design. The work is transcription discipline, a large
validation surface, and byte-exact presentation.

## 2. Difficulty, ranked

1. **§6.2 single-patch integration.** The riskiest function in the project. The
   whole-patch namespace pass runs *first* and its decisions override the
   per-path rules. Every remaining path is then evaluated against *the same* `B`
   and `C`, and all resulting path changes are applied *simultaneously*. The
   per-path dispatch has four arms: identical in `B` and `C` → apply the
   authored change directly; identical in `C` and `T` → keep unchanged (this
   collapse happens *before* OT and is easy to omit); all-text with a text
   change → transform through the aggregate context edit `Q = diff(B, C)`;
   otherwise fall to §6.4's six ordered path rules.
2. **Warning bookkeeping.** Replay returns the *unique* warning pairs sorted by
   path then reason. But `merge` prints only pairs present in the joined replay
   and absent from the **pre-merge local replay** (§6.4), so merge must replay
   twice and difference the two warning sets. Directly tested.
3. **Validation surface.** Tests 15, 23, 25 and 27 total roughly 780 lines and
   exist almost entirely to reject malformed input. §10 requires that parsing,
   validation, replay, dirty-tree checks and target-tree construction all
   complete before any write.
4. **Terminal presentation (§7.11).** A complete second rendering of every
   command, byte-asserted across the 211 lines of test 28. Cheap if designed in
   from the start, painful to retrofit.
5. **Everything else** — CLI grammar, config precedence, HTTP, materialization —
   is ordinary work with clear specs.

## 3. Known traps

- **Sorting is by unsigned UTF-8 bytes** (§2). JavaScript's `<` on strings
  compares UTF-16 code units, which disagrees for astral characters. Use
  `Buffer.compare(Buffer.from(a), Buffer.from(b))` for every path and version
  ordering; never sort bare strings.
- **UTF-8 validity must be strict.** `buf.toString('utf8')` silently substitutes
  U+FFFD, which would misclassify binary files as text. Use
  `new TextDecoder('utf-8', { fatal: true })` and check for NUL separately
  (§4.4).
- **`JSON.parse` is too permissive.** It silently keeps the last of duplicate
  keys, yet a test asserts `snap: duplicate JSON key .+`. A reviver-based
  duplicate detector or a hand-rolled parser is required, alongside
  unknown-field rejection and integer checks (§4.1).
- **`HEAD` must write no body.** The harness deliberately uses a raw `node:net`
  connection for HEAD so that a body-writing protocol violation is observable
  rather than discarded by a high-level client.
- **`SNAP_COLOR` is validated before command execution**, and its own error is
  emitted in plain mode because no valid presentation was selected (§7.11).
- **`NO_COLOR` selects the complete plain presentation** in `auto` mode, not
  merely the suppression of color. `SNAP_COLOR=always` overrides it.
- **Revision overflow.** Revisions are positive integers capped at
  `9007199254740991`; commit must fail rather than silently saturate.

### Error message strictness

Only a small set of error strings is byte-asserted:

```text
snap: contributor.id is required; configure it locally or globally
snap: invalid command or arguments
snap: invalid commit message
snap: invalid port: 65536
snap: not a Snap repository
snap: SNAP_COLOR must be auto, always, or never
snap: target tree is already current
snap: unknown version: (a@x->2)
snap: unsupported working tree entry: <path>
snap: working tree is clean
snap: working tree is dirty
```

Validation errors are asserted with loose regexes instead — for example
`^snap: .+consumes beyond old content\n$`, `^snap: unreachable patch: .+\n$`,
`^snap: .+must have one operation\n$`. Messages may therefore be written for
human readability provided they contain the required substrings and stay on one
line.

## 4. Architecture

[`AGENTS.md`](AGENTS.md) already prescribes the module split; follow it
literally:

| Module | Responsibility |
| --- | --- |
| `version` | contributor IDs, canonical `()` syntax, four-way comparison, join, Snap order |
| `text` | tokenization, text detection, canonical diff (§5), edit scripts, OT (§6.3) |
| `repository` | strict JSON reader, typed model, validation (§4.5), replay and integration (§6) |
| `materialize` | writing a path/byte map to disk, directory creation and pruning |
| `worktree` | scanning, dirty detection, unsupported-entry rejection |
| `http` | `--serve` server and the read-only client |
| `commands` | one function per command, returning structured results |
| `cli` | argument grammar, presentation selection, dispatch, exit codes |

Two structural rules imposed from the first commit:

1. **No command writes to a stream directly.** Each command returns a structured
   result value; a single presentation layer renders it in plain or terminal
   mode. This is the only way §7.11 stays inexpensive.
2. **One typed error class**, carrying expected (exit 1) versus internal
   (exit 2) status. The `snap: ` prefix and stream routing are applied once, at
   the top level.

Validation is the only door into the in-memory repository model. There is no
code path that constructs a repository value without passing §4.5.

## 5. Milestones

Ordered so that the acceptance suite itself becomes the progress meter
(`./verify --lang ts --filter 04`). Because every case is integration-level,
nothing passes until a vertical slice exists — so M1 deliberately cuts through
all layers with a simplified replay, which M3 then generalizes.

### M0 — Skeleton

Module layout, typed error class, exit-code routing, presentation stub with
`SNAP_COLOR`/`NO_COLOR` resolution, and the strict CLI grammar (options in the
exact positions shown in §7, at most once, unknown options and extra operands
rejected).

*Unlocks:* 24.

### M1 — Walking skeleton

Version algebra (§3), strict repository JSON read/write, working-tree scan,
tokenization and canonical diff (§5), and the commands `init`, `config`,
`status`, `log`, `commit`, plus argument-free `diff`. Replay may assume a linear
history at this stage.

*Unlocks:* 01, 02, 03, 04, 05.

### M2 — Validation

The complete §4.5 pipeline: schema, all versions/IDs/paths/messages/changes,
patch sorting, one value per dot, contiguous revisions, base closure,
`revision = base[author] + 1`, acyclic causality, every change checked against
its materialized exact base, and deterministic replay of the declared frontier.

*Unlocks:* 14, 15, 23, 25, 27.

### M3 — Replay, OT and merge

The core. Ready-set selection and ordering (§6.1), single-patch integration with
the namespace pass (§6.2), the OT transform (§6.3), the six path-level rules
(§6.4), warning collection and set difference, and the `merge` command including
the dot-collision corruption check.

Budget roughly a third of total effort here.

*Unlocks:* 09, 10, 11, 16, 17, 18, 20, 21, 22.

### M4 — Filesystem and revert

Materialization edge cases (files blocking directories, newly empty directory
pruning), binary and empty files, symlink and special-file rejection, and
`revert` with its additive semantics and generated message.

*Unlocks:* 06, 07, 08, 26.

### M5 — HTTP

`snap --serve` with its startup snapshot, loopback binding, port selection and
signal handling; the read-only client; and `diff --repo` including the
cross-repository shared-dot comparison.

*Unlocks:* 12, 13, 19.

### M6 — Terminal presentation

The full §7.11 rendering: success lines, status layout, log entries, diff line
styling, warnings and errors, and the `--serve` URL staying plain.

*Unlocks:* 28.

### M7 — Spec obligations beyond the suite

§11 requires two things the public harness cannot cover:

- unit tests for `auto` presentation selection with TTY and non-TTY stdout and
  stderr **independently**, since the harness captures through pipes and offers
  no portable PTY; and
- property tests generating valid causal patch graphs, verifying that import
  permutations produce the same joined frontier, patch set, warnings and tree.

See §6 for how the property-test work is delegated.

## 6. Parallelism and subagent use

Subagents are opt-in and separately billed, so this section records where the
fan-out is worth its cost and where it is actively harmful. The default remains
single-threaded implementation.

### Where subagents do not help

**Writing the modules.** This project's characteristic failure is inconsistent
interpretation of small details, which is precisely what parallel authors
produce: three agents reading §5, §6.3 and §6.4 independently will each make
defensible micro-decisions about tie-breaks, warning dedup and coalescing that
do not compose. The modules are also sequentially dependent — diff feeds OT
feeds replay — so there is little genuine parallelism to harvest.

**Presentation.** §7.11 is byte-exact across every command; it wants one
consistent author.

**Routine correctness checking.** The acceptance suite is already an exact
oracle. `./verify --lang ts --filter 22` answers faster and more reliably than
any reviewer.

### Adversarial review — the highest-value use

Deploy after M3 is written and passing, and again at the end of M4 and M6. The
premise is that by the time a module passes its tests, its author has
rationalized every choice made along the way; a reader who has never seen those
choices has not.

Give the agent the relevant spec section and the implementation, and ask it to
**find divergences, not to summarize**. Useful framings, one agent per target:

- §6.2 line by line: does the namespace pass truly run before per-path rules and
  override them? Are all paths evaluated against the *same* `B` and `C`? Are the
  resulting changes applied simultaneously rather than folded in one at a time?
  Is the "identical in `C` and `T`" collapse checked *before* OT rather than
  after?
- §6.3 against the transform: is the `Q insert` priority row honoured before all
  others? Are split counts handled on every row? Does a trailing insertion get
  processed with its applicable row rather than dropped?
- §6.4 against the path rules: are the six rules evaluated **in order**, and does
  each rule that discards a whole effect emit exactly one warning pair?
- §7.11 against the renderer: every SGR code, literal space and LF, and the
  guarantee that presentation never alters warning selection, order or exit
  status.

The output should be a list of concrete suspected divergences with spec
citations, which then become test cases. Findings are hypotheses until the
harness confirms them.

### Adversarial test authoring

Passing the packaged suite is the grade, but it is not proof: the suite pins
behaviour the spec requires, yet the spec requires more than the suite pins.
A subagent can write **additional** cases in the [`TEST-HARNESS.md`](TEST-HARNESS.md)
format targeting exactly the gaps, kept separate from `tests/` so the packaged
suite stays pristine. Candidate targets, all spec-required and none obviously
covered:

- path ordering with astral-plane characters, where UTF-16 and UTF-8 byte order
  disagree;
- revision arithmetic at the `9007199254740991` boundary;
- `NO_COLOR` set to the empty string, and its interaction with
  `SNAP_COLOR=always`;
- a text file whose final token lacks a trailing LF, across create, edit, revert
  and diff;
- concurrent creates where one side's content is invalid UTF-8.

### Property testing (satisfies part of M7)

§11 asks for property tests generating valid causal patch graphs and verifying
that import permutations produce the same joined frontier, patch set, warnings
and tree. This is a self-contained, well-specified brief with a clear success
signal, which makes it a good delegation. The generator must produce *valid*
graphs — contiguous revisions per contributor, complete base closure — so the
brief must include §3.5 and §4.5, not just the invariant under test.

The same shape covers §1's import laws directly: idempotence, commutativity and
associativity of merge, and §6.5's guarantee that merge direction cannot change
the joined result.

### Read-only reconnaissance

Cheap, parallel, and blocking other work — run these first:

- resolve the three open questions in §7 below, one agent per question, each
  reporting which test pins the behaviour and what it pins it to;
- extract golden expectations from tests 05, 22 and 28 into a compact reference
  table of exact expected bytes, so implementation does not require re-reading
  YAML.

### Rules for any delegation here

1. Quote the spec section into the brief. Never assume the agent will read
   `SPEC.md` the same way twice.
2. Ask for divergences and citations, never for a summary or a verdict.
3. Treat every finding as a hypothesis until `./verify` confirms it — a
   confident agent report is not evidence.
4. Never let a subagent edit implementation code. Findings come back as text;
   the fix is made once, by one hand.

## 7. Open questions

To be resolved against the acceptance suite rather than by guesswork, before the
affected milestone begins.

1. **Is `1.0` a non-integer?** §4.1 makes non-integer numbers an error, but
   JavaScript parses `1.0` to the integer `1`. Current intent is to reject it by
   inspecting the raw numeric token. Confirm against test 23 before M2.
2. **§6.2 rule 3 requires `B`, `C` and `T` to all be text.** A binary base with
   text current and target content therefore falls through to §6.4. Confirm
   against tests 10 and 22 before M3.
3. **Aggregate context edit scope.** `Q = diff(B, C)` is understood as the diff
   of the token sequences of that single path, not a tree-wide construct.
   Confirm against test 18 before M3.

## 8. Housekeeping

[`AGENTS.md`](AGENTS.md) and [`ts/AGENTS.md`](ts/AGENTS.md) both instruct the
reader to run `./capstones/snap/verify --lang ts`, but in this layout the
verifier is `./verify` at the repository root. Leftover packaging path; correct
it so the documented commands are runnable as written.
