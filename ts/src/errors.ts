/**
 * Expected failures (SPEC.md §10): reported as one line on stderr and exit 1.
 * Anything else escaping to the top level is an internal failure and exits 2.
 */
export class SnapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapError";
  }
}

export const EXIT_SUCCESS = 0;
export const EXIT_EXPECTED = 1;
export const EXIT_INTERNAL = 2;
