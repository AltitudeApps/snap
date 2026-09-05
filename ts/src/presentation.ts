import { SnapError } from "./errors.js";

/**
 * SPEC.md §7.11. Plain mode is the byte-stable interface; terminal mode adds
 * ANSI presentation. Selecting a presentation never changes execution,
 * effects, warning selection or order, or exit status.
 */
export type Mode = "plain" | "terminal";

export interface Presentation {
  readonly stdout: Mode;
  readonly stderr: Mode;
}

export const PLAIN: Presentation = { stdout: "plain", stderr: "plain" };

const ESC = "\u001b[";
const RESET = "\u001b[0m";

const BOLD = 1;
const DIM = 2;
const RED = 31;
const GREEN = 32;
const YELLOW = 33;
const MAGENTA = 35;
const CYAN = 36;

/** S(n, text) from §7.11. */
export function sgr(code: number, text: string): string {
  return ESC + String(code) + "m" + text + RESET;
}

export interface Streams {
  readonly stdoutIsTty: boolean;
  readonly stderrIsTty: boolean;
}

/**
 * `NO_COLOR` is treated conservatively: its presence, including an empty
 * value, selects the complete plain presentation in `auto` mode.
 * `SNAP_COLOR=always` is the explicit override and wins over it.
 */
export function resolvePresentation(
  env: Readonly<Record<string, string | undefined>>,
  streams: Streams,
): Presentation {
  const requested = env["SNAP_COLOR"];
  if (requested === "never") return PLAIN;
  if (requested === "always") return { stdout: "terminal", stderr: "terminal" };
  if (requested !== undefined && requested !== "auto") {
    throw new SnapError("SNAP_COLOR must be auto, always, or never");
  }
  if (env["NO_COLOR"] !== undefined) return PLAIN;
  return {
    stdout: streams.stdoutIsTty ? "terminal" : "plain",
    stderr: streams.stderrIsTty ? "terminal" : "plain",
  };
}

export type SuccessLabel =
  | "Initialized repository"
  | "Committed"
  | "Reverted"
  | "Merged";

export type StatusCode = "A" | "M" | "D";

export interface StatusEntry {
  readonly code: StatusCode;
  readonly path: string;
}

export interface LogEntry {
  readonly version: string;
  readonly author: string;
  /** Already escaped per §7.4. */
  readonly message: string;
}

/** What a command produced, before any presentation is chosen. */
export type Output =
  | { readonly kind: "silent" }
  | { readonly kind: "success"; readonly label: SuccessLabel; readonly version: string }
  | {
      readonly kind: "status";
      readonly version: string;
      readonly entries: readonly StatusEntry[];
    }
  | { readonly kind: "log"; readonly entries: readonly LogEntry[] }
  | { readonly kind: "diff"; readonly lines: readonly string[] }
  | { readonly kind: "toolVersion"; readonly semver: string }
  /** The --serve startup URL, which always stays plain so it can be copied. */
  | { readonly kind: "plain"; readonly text: string };

interface StatusStyle {
  readonly symbol: string;
  readonly color: number;
  readonly label: string;
}

const STATUS_STYLE: Readonly<Record<StatusCode, StatusStyle>> = {
  A: { symbol: "+", color: GREEN, label: "added" },
  D: { symbol: "−", color: RED, label: "deleted" },
  M: { symbol: "~", color: YELLOW, label: "modified" },
};

/** First applicable prefix decides the style of a diff line (§7.11). */
const DIFF_STYLES: readonly (readonly [string, number])[] = [
  ["--- ", BOLD],
  ["+++ ", BOLD],
  ["@@ ", CYAN],
  ["-", RED],
  ["+", GREEN],
  ["\\ ", DIM],
  ["Binary files ", YELLOW],
];

function styleDiffLine(line: string): string {
  for (const [prefix, code] of DIFF_STYLES) {
    if (line.startsWith(prefix)) return sgr(code, line);
  }
  return line;
}

export function renderOutput(output: Output, mode: Mode): string {
  switch (output.kind) {
    case "silent":
      return "";
    case "plain":
      return output.text + "\n";
    case "toolVersion": {
      const line = "snap " + output.semver;
      return (mode === "plain" ? line : sgr(BOLD, line)) + "\n";
    }
    case "success":
      return mode === "plain"
        ? output.version + "\n"
        : sgr(GREEN, "✓") +
            " " +
            sgr(BOLD, output.label) +
            " " +
            sgr(CYAN, output.version) +
            "\n";
    case "status":
      return mode === "plain" ? plainStatus(output) : terminalStatus(output);
    case "log":
      return mode === "plain" ? plainLog(output) : terminalLog(output);
    case "diff": {
      const lines = mode === "plain" ? output.lines : output.lines.map(styleDiffLine);
      return lines.map((line) => line + "\n").join("");
    }
  }
}

interface StatusOutput {
  readonly version: string;
  readonly entries: readonly StatusEntry[];
}

function plainStatus(output: StatusOutput): string {
  let text = "version " + output.version + "\n";
  for (const entry of output.entries) {
    text += entry.code + " " + entry.path + "\n";
  }
  return text;
}

function terminalStatus(output: StatusOutput): string {
  const header = sgr(BOLD, "Snap status") + "  " + sgr(CYAN, output.version) + "\n\n";
  if (output.entries.length === 0) {
    return header + "  " + sgr(GREEN, "✓") + " Working tree clean\n";
  }
  let text = header;
  for (const entry of output.entries) {
    const style = STATUS_STYLE[entry.code];
    text +=
      "  " +
      sgr(style.color, style.symbol) +
      " " +
      entry.path +
      " " +
      sgr(DIM, "(" + style.label + ")") +
      "\n";
  }
  return text;
}

function plainLog(output: { readonly entries: readonly LogEntry[] }): string {
  return output.entries
    .map((entry) => entry.version + "\t" + entry.author + "\t" + entry.message + "\n")
    .join("");
}

function terminalLog(output: { readonly entries: readonly LogEntry[] }): string {
  return output.entries
    .map(
      (entry) =>
        sgr(CYAN, "●") +
        " " +
        sgr(BOLD, entry.message) +
        "\n  " +
        sgr(CYAN, entry.version) +
        " " +
        sgr(DIM, "by") +
        " " +
        sgr(MAGENTA, entry.author) +
        "\n",
    )
    .join("\n");
}

export function renderWarning(detail: string, mode: Mode): string {
  return mode === "plain"
    ? "warning: " + detail + "\n"
    : sgr(YELLOW, "⚠") + " " + sgr(YELLOW, detail) + "\n";
}

export function renderError(detail: string, mode: Mode): string {
  const line = "snap: " + detail;
  return (mode === "plain" ? line : sgr(RED, "✗ " + line)) + "\n";
}
