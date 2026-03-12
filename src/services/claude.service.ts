import { spawn, ChildProcess } from 'child_process';
import { exec } from '../utils/shell.js';

/**
 * Options for running the Claude CLI.
 */
export interface ClaudeRunOptions {
  /** The prompt to send to Claude */
  prompt: string;
  /** Maximum number of turns for the agent conversation */
  maxTurns: number;
  /** Comma-separated list of allowed tools (e.g., "Read,Write,Bash") */
  allowedTools: string;
  /** Path to write verbose log output */
  logFile: string;
  /** Enable verbose output (default: false) */
  verbose?: boolean;
}

/**
 * ClaudeService wraps the Claude CLI for running agent sessions.
 *
 * Spawns the `claude` command with appropriate flags and streams output.
 * The Claude CLI must be installed and available in PATH.
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
   * Runs a Claude agent session with the specified options.
   *
   * Spawns: claude -p "prompt" --max-turns N --allowedTools "tools" [--verbose] --output-format stream-json
   *
   * The process runs asynchronously and streams output.
   * Verbose logs are written to the specified log file.
   *
   * @param options - Claude run options
   * @returns Promise that resolves with the spawned ChildProcess
   */
  async run(options: ClaudeRunOptions): Promise<ChildProcess> {
    const args = [
      '-p',
      options.prompt,
      '--max-turns',
      String(options.maxTurns),
      '--allowedTools',
      options.allowedTools,
    ];

    // Only add --verbose if explicitly enabled
    if (options.verbose) {
      args.push('--verbose');
    }

    args.push('--output-format', 'stream-json');

    // Spawn claude process
    const child = spawn('claude', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        CLAUDE_LOG_FILE: options.logFile,
      },
    });

    return child;
  }
}
