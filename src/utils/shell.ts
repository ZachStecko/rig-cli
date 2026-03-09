import { exec as cpExec } from 'child_process';

/**
 * Result of a shell command execution.
 */
export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Executes a shell command and returns the result.
 *
 * IMPORTANT: This wrapper NEVER throws. Non-zero exit codes are returned
 * in the exitCode field. Callers must check exitCode to detect failures.
 *
 * This design makes testing easier and gives callers control over error handling.
 *
 * @param command - Shell command to execute
 * @param options - Execution options (cwd, timeout)
 * @returns Promise resolving to stdout, stderr, and exitCode
 *
 * @example
 * const result = await exec('git status');
 * if (result.exitCode !== 0) {
 *   throw new Error(`git status failed: ${result.stderr}`);
 * }
 */
export async function exec(command: string, options: { cwd?: string; timeout?: number } = {}): Promise<ShellResult> {
  return new Promise((resolve) => {
    cpExec(command, { cwd: options.cwd, timeout: options.timeout }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout?.toString() ?? '',
        stderr: stderr?.toString() ?? '',
        exitCode: error ? (error as NodeJS.ErrnoException & { code?: number }).code ?? 1 : 0,
      });
    });
  });
}
