import { spawn } from 'child_process';
import { exec } from '../utils/shell.js';

/**
 * ClaudeService wraps the Claude CLI for one-shot prompts.
 *
 * Spawns the `claude` command with appropriate flags and returns the
 * response text. The Claude CLI must be installed and available in PATH.
 */
export class ClaudeService {
  /**
   * Checks if the Claude CLI is installed.
   *
   * @returns true if claude is available, false otherwise
   */
  async isInstalled(): Promise<boolean> {
    const result = await exec('claude --version');
    return result.exitCode === 0;
  }

  /**
   * Sends a simple prompt to Claude and returns the text response.
   *
   * In normal mode: uses --output-format json (silent, returns at end).
   * In verbose mode: uses --output-format stream-json to show Claude's
   * text output in real-time as it generates.
   *
   * @param prompt - The prompt to send to Claude
   * @param options - Optional settings for verbose output and timeout
   * @returns Promise that resolves with Claude's response text
   * @throws Error if Claude CLI is not available or we're in a nested session
   */
  async prompt(prompt: string, options?: { verbose?: boolean; timeoutMs?: number }): Promise<string> {
    if (process.env.CLAUDECODE) {
      throw new Error('Cannot call Claude CLI from within a Claude Code session (nested sessions not supported)');
    }

    const verbose = options?.verbose ?? false;
    const timeoutMs = options?.timeoutMs ?? 120_000;

    if (verbose) {
      return this.promptStreaming(prompt, timeoutMs);
    }
    return this.promptBuffered(prompt, timeoutMs);
  }

  /**
   * Buffered prompt — uses --output-format json and waits for full output.
   *
   * Spawns without a shell so backticks, quotes, and dollar signs in the
   * prompt reach claude literally instead of being shell-interpreted.
   */
  private promptBuffered(prompt: string, timeoutMs: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const child = spawn('claude', ['-p', prompt, '--output-format', 'json'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      // timeoutMs <= 0 means no timeout
      const timer = timeoutMs > 0
        ? setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error(`Claude prompt timed out after ${timeoutMs / 1000}s`));
          }, timeoutMs)
        : null;

      child.once('error', (error) => {
        if (timer) clearTimeout(timer);
        reject(new Error(`Failed to spawn claude: ${error.message}`));
      });

      child.once('close', (code) => {
        if (timer) clearTimeout(timer);
        if (code !== 0) {
          // The CLI sometimes reports errors on stdout (as JSON) with an
          // empty stderr; include whichever stream has content.
          const detail = stderr.trim() || stdout.trim().slice(0, 500) || `exit code ${code}`;
          reject(new Error(`Claude prompt failed: ${detail}`));
          return;
        }
        resolve(this.parseJsonResponse(stdout));
      });
    });
  }

  /**
   * Streaming prompt — uses --output-format stream-json with --verbose.
   * Prints Claude's text output to stdout in real-time.
   */
  private promptStreaming(prompt: string, timeoutMs: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const args = ['-p', prompt, '--verbose', '--output-format', 'stream-json'];
      const child = spawn('claude', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let buffer = '';
      // Only keep text from the latest assistant message — Claude may
      // produce multiple assistant turns (exploring files, thinking, etc.)
      // and we only want the final response for parsing.
      let currentMessageText: string[] = [];
      let lastMessageText: string[] = [];

      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            if (event.type === 'assistant' && event.message?.content) {
              // New assistant message — save previous and start fresh
              if (currentMessageText.length > 0) {
                lastMessageText = currentMessageText;
              }
              currentMessageText = [];
              for (const block of event.message.content) {
                if (block.type === 'text' && block.text) {
                  process.stdout.write(block.text);
                  currentMessageText.push(block.text);
                }
              }
            }
          } catch {
            // Skip unparseable lines
          }
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        process.stderr.write(chunk.toString());
      });

      // timeoutMs <= 0 means no timeout
      const timer = timeoutMs > 0
        ? setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error(`Claude prompt timed out after ${timeoutMs / 1000}s`));
          }, timeoutMs)
        : null;

      child.once('error', (error) => {
        if (timer) clearTimeout(timer);
        reject(new Error(`Failed to spawn claude: ${error.message}`));
      });

      child.once('close', (code) => {
        if (timer) clearTimeout(timer);
        // Parse any remaining buffer
        if (buffer.trim()) {
          try {
            const event = JSON.parse(buffer);
            if (event.type === 'assistant' && event.message?.content) {
              if (currentMessageText.length > 0) {
                lastMessageText = currentMessageText;
              }
              currentMessageText = [];
              for (const block of event.message.content) {
                if (block.type === 'text' && block.text) {
                  currentMessageText.push(block.text);
                }
              }
            }
          } catch {
            // Skip
          }
        }
        if (code !== 0) {
          reject(new Error(`Claude prompt failed (exit code ${code})`));
          return;
        }
        // Add newline after streamed output
        process.stdout.write('\n');
        // Return text from the final assistant message
        const finalText = currentMessageText.length > 0 ? currentMessageText : lastMessageText;
        resolve(finalText.join(''));
      });
    });
  }

  /**
   * Parse a JSON response from claude --output-format json.
   */
  private parseJsonResponse(stdout: string): string {
    try {
      const response = JSON.parse(stdout);
      if (response.content && Array.isArray(response.content)) {
        const textBlocks = response.content
          .filter((block: any) => block.type === 'text')
          .map((block: any) => block.text);
        return textBlocks.join('\n');
      }
      return response.text || response.content || '';
    } catch {
      return stdout.trim();
    }
  }

}
