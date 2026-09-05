import { SnapError } from "./errors.js";

/**
 * SPEC.md §7 grammar. Options occur exactly in the positions shown and may
 * appear at most once; unknown options, extra operands, and missing option
 * values are errors.
 */
export interface DiffCompare {
  readonly old: string;
  readonly new: string;
  /** Present only when --repo was supplied. */
  readonly repository: string | undefined;
}

export type Command =
  | { readonly name: "init"; readonly path: string }
  | { readonly name: "config"; readonly global: boolean; readonly id: string }
  | { readonly name: "status" }
  | { readonly name: "log" }
  | { readonly name: "commit"; readonly message: string }
  | { readonly name: "diff"; readonly compare: DiffCompare | undefined }
  | { readonly name: "revert"; readonly version: string }
  | { readonly name: "merge"; readonly repository: string }
  | { readonly name: "serve"; readonly port: number }
  | { readonly name: "toolVersion" };

const INVALID = "invalid command or arguments";
const DIFF_USAGE = "usage: snap diff [<old> <new> [--repo <repository>]]";

export const DEFAULT_PORT = 8765;
const MAX_PORT = 65535;

function invalid(): never {
  throw new SnapError(INVALID);
}

function diffUsage(): never {
  throw new SnapError(DIFF_USAGE);
}

/**
 * An operand that looks like an option is rejected rather than consumed, so
 * `snap init --unknown` cannot create a directory named `--unknown`.
 */
function operand(value: string | undefined): string {
  if (value === undefined || value.startsWith("--")) invalid();
  return value;
}

export function parseArguments(argv: readonly string[]): Command {
  const head = argv[0];
  if (head === undefined) invalid();
  const rest = argv.slice(1);

  switch (head) {
    case "--version":
      if (rest.length !== 0) invalid();
      return { name: "toolVersion" };

    case "--serve":
      return parseServe(rest);

    case "init": {
      if (rest.length > 1) invalid();
      if (rest.length === 0) return { name: "init", path: "." };
      return { name: "init", path: operand(rest[0]) };
    }

    case "config":
      return parseConfig(rest);

    case "status":
      if (rest.length !== 0) invalid();
      return { name: "status" };

    case "log":
      if (rest.length !== 0) invalid();
      return { name: "log" };

    case "commit": {
      // The message is free text, so it is not screened for an option shape.
      if (rest.length !== 1) invalid();
      const message = rest[0];
      if (message === undefined) invalid();
      return { name: "commit", message };
    }

    case "diff":
      return parseDiff(rest);

    case "revert":
      if (rest.length !== 1) invalid();
      return { name: "revert", version: operand(rest[0]) };

    case "merge":
      if (rest.length !== 1) invalid();
      return { name: "merge", repository: operand(rest[0]) };

    default:
      invalid();
  }
}

function parseServe(rest: readonly string[]): Command {
  if (rest.length > 1) invalid();
  if (rest.length === 0) return { name: "serve", port: DEFAULT_PORT };
  const token = operand(rest[0]);
  if (!/^(?:0|[1-9][0-9]*)$/.test(token)) {
    throw new SnapError("invalid port: " + token);
  }
  const port = Number(token);
  if (port > MAX_PORT) throw new SnapError("invalid port: " + token);
  return { name: "serve", port };
}

function parseConfig(rest: readonly string[]): Command {
  const global = rest[0] === "--global";
  const tail = global ? rest.slice(1) : rest;
  if (tail.length !== 2) invalid();
  if (tail[0] !== "contributor.id") invalid();
  // The ID's own syntax is validated by the command, not the grammar.
  return { name: "config", global, id: operand(tail[1]) };
}

function parseDiff(rest: readonly string[]): Command {
  if (rest.length === 0) return { name: "diff", compare: undefined };
  if (rest.length !== 2 && rest.length !== 4) diffUsage();

  const oldVersion = rest[0];
  const newVersion = rest[1];
  if (oldVersion === undefined || newVersion === undefined) diffUsage();
  if (oldVersion.startsWith("--") || newVersion.startsWith("--")) diffUsage();

  if (rest.length === 2) {
    return {
      name: "diff",
      compare: { old: oldVersion, new: newVersion, repository: undefined },
    };
  }

  if (rest[2] !== "--repo") diffUsage();
  const repository = rest[3];
  if (repository === undefined || repository.startsWith("--")) diffUsage();
  return {
    name: "diff",
    compare: { old: oldVersion, new: newVersion, repository },
  };
}
