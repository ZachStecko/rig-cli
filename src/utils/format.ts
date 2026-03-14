/**
 * Utility functions for formatting output
 */

/**
 * Attempts to pretty-print a line as JSON, or outputs it as-is if not valid JSON.
 *
 * @param line - Line of text to format
 */
export function prettyPrintJson(line: string): void {
  try {
    const obj = JSON.parse(line);
    process.stdout.write(JSON.stringify(obj, undefined, 2) + '\n');
  } catch {
    // Not JSON, output as-is
    process.stdout.write(line + '\n');
  }
}
