import chalk from 'chalk';
import ora, { Ora } from 'ora';

/**
 * Logger service for consistent terminal output formatting.
 * Wraps chalk for colors and ora for spinners.
 *
 * All output goes to stdout (via console.log) except errors which go to stderr.
 * This makes it easy to redirect or capture output in tests and production.
 *
 * Note: Colors are force-enabled by default. Set NO_COLOR=1 to disable.
 *
 * Verbose mode can be enabled to show detailed debug information including:
 * - Shell commands being executed
 * - Timing information for operations
 * - Configuration values being used
 */
export class Logger {
  private verbose: boolean = false;

  constructor() {
    // Force color support unless NO_COLOR is set
    if (!process.env.NO_COLOR) {
      chalk.level = 3; // Force truecolor support
    }
  }

  /**
   * Enables or disables verbose mode.
   * In verbose mode, additional debug information is displayed.
   *
   * @param enabled - Whether to enable verbose output
   */
  setVerbose(enabled: boolean): void {
    this.verbose = enabled;
  }
  /**
   * Prints an informational message in blue.
   *
   * @param message - Message to display
   * @example
   * logger.info("Fetching issues from GitHub...")
   */
  info(message: string): void {
    console.log(chalk.blue(message));
  }

  /**
   * Prints a success message in green with a checkmark.
   *
   * @param message - Success message to display
   * @example
   * logger.success("Tests passed!")
   */
  success(message: string): void {
    console.log(chalk.green(`✓ ${message}`));
  }

  /**
   * Prints a warning message in yellow with a warning symbol.
   *
   * @param message - Warning message to display
   * @example
   * logger.warn("No demo recorded for this component")
   */
  warn(message: string): void {
    console.log(chalk.yellow(`⚠ ${message}`));
  }

  /**
   * Prints an error message in red to stderr with an X symbol.
   *
   * @param message - Error message to display
   * @example
   * logger.error("Failed to create branch")
   */
  error(message: string): void {
    console.error(chalk.red(`✗ ${message}`));
  }

  /**
   * Prints a bold section header in cyan.
   * Used to separate major sections of output.
   *
   * @param message - Header text
   * @example
   * logger.header("Running Tests")
   */
  header(message: string): void {
    console.log(chalk.cyan.bold(`\n${message}`));
  }

  /**
   * Prints a progress step indicator.
   * Format: [current/total] message
   *
   * @param current - Current step number
   * @param total - Total number of steps
   * @param message - Step description
   * @example
   * logger.step(2, 5, "Running tests")
   * // Output: [2/5] Running tests
   */
  step(current: number, total: number, message: string): void {
    console.log(chalk.dim(`[${current}/${total}]`) + ` ${message}`);
  }

  /**
   * Prints dimmed/muted text in gray.
   * Used for less important details.
   *
   * @param message - Message to display dimmed
   * @example
   * logger.dim("  Using default configuration")
   */
  dim(message: string): void {
    console.log(chalk.dim(message));
  }

  /**
   * Displays a spinner while a promise executes.
   * Shows a loading animation with the message, then hides it when done.
   *
   * If the promise rejects, the spinner shows a failure state and re-throws.
   * If the promise resolves, the spinner is cleared and returns the result.
   *
   * @param promise - Async operation to wrap
   * @param message - Text to show next to the spinner
   * @returns The resolved value from the promise
   * @throws Re-throws any error from the promise
   *
   * @example
   * const issues = await logger.spinner(
   *   fetchIssues(),
   *   "Fetching issues from GitHub..."
   * );
   */
  async spinner<T>(promise: Promise<T>, message: string): Promise<T> {
    const spinner: Ora = ora(message).start();
    try {
      const result = await promise;
      spinner.stop();
      return result;
    } catch (error) {
      spinner.fail(message);
      throw error;
    }
  }

  /**
   * Logs a shell command being executed (verbose mode only).
   * Displays in cyan with a ">" prefix to indicate command execution.
   *
   * @param command - Shell command being executed
   * @example
   * logger.command("cd backend && go test ./...");
   * // Output (if verbose): > cd backend && go test ./...
   */
  command(command: string): void {
    if (!this.verbose) return;
    console.log(chalk.cyan(`  > ${command}`));
  }

  /**
   * Logs timing information for an operation (verbose mode only).
   * Displays elapsed time in a human-readable format.
   *
   * @param label - Operation name/description
   * @param ms - Elapsed time in milliseconds
   * @example
   * logger.timing("Backend tests", 2350);
   * // Output (if verbose): ⏱ Backend tests: 2.35s
   */
  timing(label: string, ms: number): void {
    if (!this.verbose) return;
    const seconds = (ms / 1000).toFixed(2);
    console.log(chalk.dim(`  ⏱  ${label}: ${seconds}s`));
  }

  /**
   * Logs a configuration value being used (verbose mode only).
   * Displays config key-value pairs for debugging.
   *
   * @param label - Configuration setting name
   * @param value - Configuration value
   * @example
   * logger.config("Backend directory", "./backend");
   * // Output (if verbose): [config] Backend directory: ./backend
   */
  config(label: string, value: any): void {
    if (!this.verbose) return;
    console.log(chalk.dim(`  [config] ${label}: ${value}`));
  }
}
