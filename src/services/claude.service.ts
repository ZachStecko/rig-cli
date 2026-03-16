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
  /** Permission mode for file operations: 'default', 'bypassPermissions', 'acceptEdits', 'dontAsk', 'plan', or 'auto' (default: 'bypassPermissions') */
  permissionMode?: 'default' | 'bypassPermissions' | 'acceptEdits' | 'dontAsk' | 'plan' | 'auto';
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
   * Detects if the current environment is a server/CI environment.
   *
   * @returns true if running in CI/server environment, false for local development
   */
  private isServerEnvironment(): boolean {
    const ciEnvVars = [
      'CI',
      'GITHUB_ACTIONS',
      'GITLAB_CI',
      'CIRCLECI',
      'TRAVIS',
      'JENKINS_HOME',
      'BUILDKITE',
      'DRONE',
      'CODEBUILD_BUILD_ID',
    ];

    const isCI = ciEnvVars.some(envVar => !!process.env[envVar]);

    const hasDockerEnv = !!process.env.DOCKER_CONTAINER;

    return isCI || hasDockerEnv;
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
   * Buffered prompt — uses shell exec with --output-format json.
   * Reliable: waits for full output before resolving.
   */
  private async promptBuffered(prompt: string, timeoutMs: number): Promise<string> {
    const result = await exec(
      `claude -p ${JSON.stringify(prompt)} --output-format json`,
      { timeout: timeoutMs }
    );

    if (result.exitCode !== 0) {
      throw new Error(`Claude prompt failed: ${result.stderr}`);
    }

    return this.parseJsonResponse(result.stdout);
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

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Claude prompt timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);

      child.once('error', (error) => {
        clearTimeout(timer);
        reject(new Error(`Failed to spawn claude: ${error.message}`));
      });

      child.once('close', (code) => {
        clearTimeout(timer);
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

  /**
   * Runs a Claude agent session with the specified options.
   *
   * Spawns: claude -p "prompt" --max-turns N --allowedTools "tools" [--verbose] --output-format stream-json
   *
   * @param options - Claude run options
   * @returns Promise that resolves with the spawned ChildProcess
   */
  async run(options: ClaudeRunOptions): Promise<ChildProcess> {
    const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
    const isServerEnv = this.isServerEnvironment();

    if (isServerEnv && !hasApiKey) {
      console.warn('\nWarning: Running rig-cli in a CI/server environment without ANTHROPIC_API_KEY.');
      console.warn('   Anthropic\'s Terms of Service require API key authentication for production use.');
      console.warn('   For personal use on your local machine, subscription auth is fine.');
      console.warn('   See: https://console.anthropic.com/ to get an API key\n');
    }

    const args = [
      '-p',
      options.prompt,
      '--max-turns',
      String(options.maxTurns),
      '--allowedTools',
      options.allowedTools,
    ];

    if (options.permissionMode) {
      args.push('--permission-mode', options.permissionMode);
    }

    // stream-json requires --verbose, so always enable it
    args.push('--verbose');
    args.push('--output-format', 'stream-json');

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
