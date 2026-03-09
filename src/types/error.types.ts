/**
 * Custom error thrown by GuardService when preconditions are not met.
 * Allows callers to distinguish guard failures from other errors.
 */
export class GuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GuardError';

    // Maintain proper stack trace for where error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, GuardError);
    }
  }
}
