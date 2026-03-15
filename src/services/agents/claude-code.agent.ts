import { ChildProcess } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { ClaudeService } from '../claude.service.js';
import { CodeAgent } from './base.agent.js';
import {
  AgentCapabilities,
  AgentEvent,
  AgentResult,
  AgentSession,
  AgentSessionConfig,
  AuthStatus,
} from './types.js';

// Constants
const DEFAULT_MAX_ITERATIONS = 80;
const DEFAULT_ALLOWED_TOOLS = ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'] as const;
const VALID_PERMISSION_MODES = ['default', 'bypassPermissions', 'acceptEdits', 'dontAsk', 'plan', 'auto'] as const;

type PermissionMode = typeof VALID_PERMISSION_MODES[number];

/**
 * Claude Code CLI agent implementation.
 *
 * Wraps the existing ClaudeService to provide the CodeAgent interface.
 * This agent uses the Claude Code CLI (`claude` command) for agentic sessions.
 */
export class ClaudeCodeAgent extends CodeAgent {
  readonly name = 'Claude Code';

  readonly capabilities: AgentCapabilities = {
    fileOperations: true,
    shellExecution: true,
    codeSearch: true,
    structuredStreaming: true,
    toolPermissions: true,
    maxIterations: true,
    webSearch: true,
  };

  private claudeService: ClaudeService;
  private sessionCounter = 0;

  constructor() {
    super();
    this.claudeService = new ClaudeService();
  }

  /**
   * Check if Claude Code CLI is installed and available.
   */
  async isAvailable(): Promise<boolean> {
    return this.claudeService.isInstalled();
  }

  /**
   * Check Claude Code authentication status.
   */
  async checkAuth(): Promise<AuthStatus> {
    // Check if API key is set
    if (process.env.ANTHROPIC_API_KEY) {
      return { authenticated: true, method: 'api_key' };
    }

    // Check if Claude CLI is installed and can run (implies logged in via subscription)
    const installed = await this.isAvailable();
    if (installed) {
      return { authenticated: true, method: 'subscription' };
    }

    return {
      authenticated: false,
      error: 'Not authenticated. Run `claude login` or set ANTHROPIC_API_KEY',
    };
  }

  /**
   * Simple prompt/response using Claude Code CLI.
   */
  async prompt(prompt: string): Promise<string> {
    return this.claudeService.prompt(prompt);
  }

  /**
   * Create a new Claude Code session.
   *
   * This spawns the `claude` CLI process and streams events.
   */
  async createSession(config: AgentSessionConfig): Promise<AgentSession> {
    // Validate and map permission mode
    const permissionMode = this.validatePermissionMode(
      config.providerOptions?.permission_mode as string | undefined
    );

    // Generate unique session ID
    const sessionId = `claude-${Date.now()}-${this.sessionCounter++}`;

    // Generate session-specific log file
    const logFile = config.logFile || join(tmpdir(), `claude-agent-${sessionId}.log`);

    // Map to ClaudeRunOptions
    const child = await this.claudeService.run({
      prompt: config.prompt,
      maxTurns: config.maxIterations || DEFAULT_MAX_ITERATIONS,
      allowedTools: config.allowedTools?.join(',') || DEFAULT_ALLOWED_TOOLS.join(','),
      logFile,
      verbose: config.verbose,
      permissionMode,
    });

    // Track completion promise to avoid duplicate event handlers
    const completionPromise = this.waitForCompletion(child, sessionId, config.workingDirectory);

    return {
      id: sessionId,
      events: this.adaptStream(child),
      wait: () => completionPromise,
      cancel: () => this.cancelSession(child),
    };
  }

  /**
   * Validate permission mode and return a valid value.
   */
  private validatePermissionMode(mode: string | undefined): PermissionMode {
    if (!mode) {
      return 'bypassPermissions';
    }

    if (VALID_PERMISSION_MODES.includes(mode as PermissionMode)) {
      return mode as PermissionMode;
    }

    console.warn(`Invalid permission mode: ${mode}. Using default: bypassPermissions`);
    return 'bypassPermissions';
  }

  /**
   * Adapt Claude Code's stream-json format to AgentEvent.
   *
   * Claude Code emits events like:
   * {"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Read", "input": {...}}]}}
   */
  private async *adaptStream(child: ChildProcess): AsyncIterableIterator<AgentEvent> {
    let buffer = '';

    if (!child.stdout) {
      yield { type: 'error', message: 'No stdout available', fatal: true };
      return;
    }

    // Handle process errors
    let processError: Error | null = null;
    child.once('error', (error) => {
      processError = error;
    });

    // Track process exit
    let processExited = false;
    let exitCode: number | null = null;
    child.once('exit', (code) => {
      processExited = true;
      exitCode = code;
    });

    // Handle stdout errors
    child.stdout.once('error', (error) => {
      processError = error;
    });

    try {
      for await (const chunk of child.stdout) {
        // Check if process errored
        if (processError) {
          yield {
            type: 'error',
            message: `Process error: ${String(processError)}`,
            fatal: true,
          };
          break;
        }

        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          const event = this.parseEvent(line);
          if (event) {
            yield event;
          }
        }
      }

      // Process any remaining buffer
      if (buffer.trim()) {
        const event = this.parseEvent(buffer);
        if (event) {
          yield event;
        }
      }
    } catch (error) {
      yield {
        type: 'error',
        message: error instanceof Error ? error.message : 'Stream processing error',
        fatal: true,
      };
    }

    // Wait for process to exit if it hasn't already
    if (!processExited) {
      await new Promise<void>((resolve) => {
        child.once('exit', (code) => {
          exitCode = code;
          resolve();
        });
      });
    }

    // Emit completion event
    yield {
      type: 'complete',
      success: exitCode === 0,
    };
  }

  /**
   * Parse a single line of Claude Code JSON output into an AgentEvent.
   */
  private parseEvent(line: string): AgentEvent | null {
    try {
      const parsed = JSON.parse(line);

      // Handle different Claude Code event types
      if (parsed.type === 'assistant' && parsed.message?.content) {
        for (const item of parsed.message.content) {
          if (item.type === 'tool_use') {
            return {
              type: 'tool_use',
              tool: item.name ?? 'unknown',
              input: item.input,
            };
          } else if (item.type === 'text') {
            return {
              type: 'text',
              content: item.text ?? '',
            };
          } else if (item.type === 'thinking') {
            return {
              type: 'thinking',
              content: item.text ?? '',
            };
          }
        }
      } else if (parsed.type === 'tool_result') {
        return {
          type: 'tool_result',
          tool: parsed.tool_name ?? 'unknown',
          output: parsed.content,
          error: parsed.is_error ? (typeof parsed.content === 'string' ? parsed.content : JSON.stringify(parsed.content)) : undefined,
        };
      } else if (parsed.type === 'error') {
        return {
          type: 'error',
          message: parsed.message ?? 'Unknown error',
          fatal: parsed.fatal === true, // Default to non-fatal
        };
      } else if (parsed.type === 'progress') {
        return {
          type: 'progress',
          step: parsed.step ?? 0,
          total: parsed.total,
        };
      }
    } catch (parseError) {
      // Silently ignore malformed JSON (shouldn't happen with stream-json format)
      return null;
    }

    return null;
  }

  /**
   * Wait for Claude Code process to complete and return result.
   *
   * Uses `once` to avoid duplicate event handlers and detects file changes via git.
   */
  private async waitForCompletion(
    child: ChildProcess,
    sessionId: string,
    workingDirectory?: string
  ): Promise<AgentResult> {
    return new Promise((resolve, reject) => {
      // Use 'once' to prevent duplicate handlers
      child.once('exit', async (code) => {
        const success = code === 0;

        // Detect files changed (if in a git repo)
        let filesChanged: string[] = [];
        if (workingDirectory) {
          try {
            const { exec } = await import('../../utils/shell.js');
            const originalCwd = process.cwd();
            process.chdir(workingDirectory);

            const result = await exec('git diff --name-only HEAD');

            process.chdir(originalCwd);

            if (result.exitCode === 0 && result.stdout) {
              filesChanged = result.stdout
                .split('\n')
                .filter((line: string) => line.trim())
                .map((line: string) => line.trim());
            }
          } catch {
            // Ignore git errors - not in a repo or git not available
          }
        }

        resolve({
          success,
          filesChanged,
          summary: success ? `Session ${sessionId} completed successfully` : `Session ${sessionId} failed`,
          error: code !== 0 ? `Process exited with code ${code}` : undefined,
        });
      });

      child.once('error', (error) => {
        reject(new Error(`Process error: ${error.message}`));
      });
    });
  }

  /**
   * Cancel a running Claude Code session.
   *
   * Sends SIGTERM first, then SIGKILL after 5 seconds if process doesn't exit.
   */
  private async cancelSession(child: ChildProcess): Promise<void> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        // Force kill if still running after 5 seconds
        child.kill('SIGKILL');
      }, 5000);

      child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });

      // Send graceful termination signal
      child.kill('SIGTERM');
    });
  }
}
