import { spawn } from 'child_process';

/**
 * Copies text to the system clipboard using the platform's native
 * clipboard command (pbcopy on macOS, clip on Windows, xclip on Linux).
 *
 * @param text - The text to copy
 * @throws Error if the clipboard command is unavailable or fails
 */
export function copyToClipboard(text: string): Promise<void> {
  const cmd =
    process.platform === 'darwin' ? { bin: 'pbcopy', args: [] as string[] }
    : process.platform === 'win32' ? { bin: 'clip', args: [] as string[] }
    : { bin: 'xclip', args: ['-selection', 'clipboard'] };

  return new Promise((resolve, reject) => {
    const child = spawn(cmd.bin, cmd.args, {
      stdio: ['pipe', 'ignore', 'ignore'],
    });

    child.once('error', (error) => {
      reject(new Error(`Clipboard command '${cmd.bin}' failed: ${error.message}`));
    });

    child.once('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Clipboard command '${cmd.bin}' exited with code ${code}`));
      }
    });

    // A failed write surfaces via the close handler; swallowing here just
    // prevents an unhandled EPIPE from crashing the process.
    child.stdin.on('error', () => {});
    child.stdin.end(text);
  });
}
