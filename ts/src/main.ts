import { parseArguments, type Command } from "./cli.js";
import { EXIT_EXPECTED, EXIT_INTERNAL, EXIT_SUCCESS, SnapError } from "./errors.js";
import { init } from "./commands/init.js";
import {
  PLAIN,
  renderError,
  renderOutput,
  renderWarning,
  resolvePresentation,
  type Output,
  type Presentation,
} from "./presentation.js";

export const SEMVER = "1.0.0";

export interface CommandResult {
  readonly output: Output;
  /** Plain warning details, without the `warning: ` prefix (§6.4). */
  readonly warnings: readonly string[];
}

function notImplemented(command: Command): never {
  throw new SnapError("not implemented: " + command.name);
}

function execute(command: Command, cwd: string): CommandResult {
  switch (command.name) {
    case "toolVersion":
      return { output: { kind: "toolVersion", semver: SEMVER }, warnings: [] };
    case "init":
      return { output: init(cwd, command.path), warnings: [] };
    default:
      notImplemented(command);
  }
}

function write(stream: NodeJS.WriteStream, text: string): void {
  if (text.length > 0) stream.write(text);
}

export function run(argv: readonly string[], cwd: string): number {
  // Presentation is resolved before the command runs, and its own error is
  // plain because no valid presentation was selected (§7.11).
  let presentation: Presentation;
  try {
    presentation = resolvePresentation(process.env, {
      stdoutIsTty: process.stdout.isTTY === true,
      stderrIsTty: process.stderr.isTTY === true,
    });
  } catch (error) {
    if (error instanceof SnapError) {
      write(process.stderr, renderError(error.message, "plain"));
      return EXIT_EXPECTED;
    }
    throw error;
  }

  try {
    const result = execute(parseArguments(argv), cwd);
    for (const warning of result.warnings) {
      write(process.stderr, renderWarning(warning, presentation.stderr));
    }
    write(process.stdout, renderOutput(result.output, presentation.stdout));
    return EXIT_SUCCESS;
  } catch (error) {
    if (error instanceof SnapError) {
      write(process.stderr, renderError(error.message, presentation.stderr));
      return EXIT_EXPECTED;
    }
    const detail = error instanceof Error ? error.message : String(error);
    write(process.stderr, renderError(detail, PLAIN.stderr));
    return EXIT_INTERNAL;
  }
}

process.exitCode = run(process.argv.slice(2), process.cwd());
