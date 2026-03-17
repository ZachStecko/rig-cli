import { ChildProcess } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { ClaudeService } from '../claude.service.js';
import { exec as execShell } from '../../utils/shell.js';
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
 * Claude Code CLI (binary) agent implementation.
 *
 * Wraps ClaudeService to provide the CodeAgent interface.
 * Uses the Claude Code CLI (`claude` command) for agentic sessions.
 * Works with a Claude Max subscription at no extra API cost.
 */
export class ClaudeBinaryAgent extends CodeAgent {
  readonly name = 'Claude Code (Binary)';

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
  private verbose: boolean;
  private timeoutMs: number;

  constructor(verbose?: boolean, timeoutMs?: number) {
    super();
    this.claudeService = new ClaudeService();
    this.verbose = verbose ?? false;
    this.timeoutMs = timeoutMs ?? 120_000;
  }

  /**
   * Check if Claude Code CLI is installed and available.
   */
  async isAvailable(): Promise<boolean> {
    return this.claudeService.isInstalled();
  }

  /**
   * Check Claude Code authentication status.
   *
   * Checks ANTHROPIC_API_KEY first, then falls back to CLI availability
   * (which implies subscription-based auth).
   */
  async checkAuth(): Promise<AuthStatus> {
    if (process.env.ANTHROPIC_API_KEY) {
      return { authenticated: true, method: 'api_key' };
    }

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
    return this.claudeService.prompt(prompt, { verbose: this.verbose, timeoutMs: this.timeoutMs });
  }

  /**
   * Create a new Claude Code session.
   *
   * Spawns the `claude` CLI process and streams events.
   */
  async createSession(config: AgentSessionConfig): Promise<AgentSession> {
    const permissionMode = this.validatePermissionMode(
      config.providerOptions?.permissionMode as string | undefined
    );

    const sessionId = `claude-${Date.now()}-${this.sessionCounter++}`;
    const logFile = config.logFile || join(tmpdir(), `claude-agent-${sessionId}.log`);

    const child = await this.claudeService.run({
      prompt: config.prompt,
      maxTurns: config.maxIterations || DEFAULT_MAX_ITERATIONS,
      allowedTools: config.allowedTools?.join(',') || DEFAULT_ALLOWED_TOOLS.join(','),
      logFile,
      verbose: config.verbose,
      permissionMode,
    });

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
   */
  private async *adaptStream(child: ChildProcess): AsyncIterableIterator<AgentEvent> {
    let buffer = '';

    if (!child.stdout) {
      yield { type: 'error', message: 'No stdout available', fatal: true };
      return;
    }

    let processError: Error | null = null;
    child.once('error', (error) => {
      processError = error;
    });

    let processExited = false;
    let exitCode: number | null = null;
    child.once('exit', (code) => {
      processExited = true;
      exitCode = code;
    });

    child.stdout.once('error', (error) => {
      processError = error;
    });

    try {
      for await (const chunk of child.stdout) {
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

          for (const event of this.parseEvents(line)) {
            yield event;
          }
        }
      }

      if (buffer.trim()) {
        for (const event of this.parseEvents(buffer)) {
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

    if (!processExited) {
      await new Promise<void>((resolve) => {
        child.once('exit', (code) => {
          exitCode = code;
          resolve();
        });
      });
    }

    yield {
      type: 'complete',
      success: exitCode === 0,
    };
  }

  /**
   * Parse a single line of Claude Code JSON output into AgentEvents.
   *
   * Returns an array because a single `assistant` message may contain
   * multiple content blocks (e.g., text + tool_use).
   */
  private parseEvents(line: string): AgentEvent[] {
    try {
      const parsed = JSON.parse(line);

      if (parsed.type === 'assistant' && parsed.message?.content) {
        const events: AgentEvent[] = [];
        for (const item of parsed.message.content) {
          if (item.type === 'tool_use') {
            events.push({
              type: 'tool_use',
              tool: item.name ?? 'unknown',
              input: item.input,
            });
          } else if (item.type === 'text') {
            events.push({
              type: 'text',
              content: item.text ?? '',
            });
          } else if (item.type === 'thinking') {
            events.push({
              type: 'thinking',
              content: item.thinking ?? item.text ?? '',
            });
          }
        }
        return events;
      } else if (parsed.type === 'tool_result') {
        return [{
          type: 'tool_result',
          tool: parsed.tool_name ?? 'unknown',
          output: parsed.content,
          error: parsed.is_error ? (typeof parsed.content === 'string' ? parsed.content : JSON.stringify(parsed.content)) : undefined,
        }];
      } else if (parsed.type === 'error') {
        return [{
          type: 'error',
          message: parsed.message ?? 'Unknown error',
          fatal: parsed.fatal === true,
        }];
      } else if (parsed.type === 'progress') {
        return [{
          type: 'progress',
          step: parsed.step ?? 0,
          total: parsed.total,
        }];
      }
    } catch (parseError) {
      return [];
    }

    return [];
  }

  /**
   * Wait for Claude Code process to complete and return result.
   *
   * Detects file changes via git diff.
   */
  private async waitForCompletion(
    child: ChildProcess,
    sessionId: string,
    workingDirectory?: string
  ): Promise<AgentResult> {
    return new Promise((resolve, reject) => {
      let settled = false;

      child.once('exit', async (code) => {
        if (settled) return;
        settled = true;

        const success = code === 0;

        let filesChanged: string[] = [];
        if (workingDirectory) {
          try {
            const result = await execShell('git diff --name-only HEAD', { cwd: workingDirectory });

            if (result.exitCode === 0 && result.stdout) {
              filesChanged = result.stdout
                .split('\n')
                .filter((line: string) => line.trim())
                .map((line: string) => line.trim());
            }
          } catch {
            // Ignore git errors
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
        if (settled) return;
        settled = true;
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
        child.kill('SIGKILL');
      }, 5000);

      child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });

      child.kill('SIGTERM');
    });
  }
}
