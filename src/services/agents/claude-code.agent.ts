import { query } from '@anthropic-ai/claude-agent-sdk';
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
 * Claude Agent SDK implementation.
 *
 * Uses the official @anthropic-ai/claude-agent-sdk for agentic sessions.
 * Requires ANTHROPIC_API_KEY environment variable.
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

  private sessionCounter = 0;

  /**
   * Check if Claude Agent SDK is available (API key is set).
   */
  async isAvailable(): Promise<boolean> {
    return !!process.env.ANTHROPIC_API_KEY;
  }

  /**
   * Check Claude Agent SDK authentication status.
   */
  async checkAuth(): Promise<AuthStatus> {
    if (process.env.ANTHROPIC_API_KEY) {
      return { authenticated: true, method: 'api_key' };
    }

    return {
      authenticated: false,
      error: 'Not authenticated. Set ANTHROPIC_API_KEY environment variable',
    };
  }

  /**
   * Simple prompt/response using Claude Agent SDK.
   */
  async prompt(promptText: string): Promise<string> {
    const responses: string[] = [];

    for await (const message of query({
      prompt: promptText,
      options: {
        model: 'claude-sonnet-4-5-20250929',
        maxTurns: 1,
        allowedTools: [],
      },
    })) {
      if (message.type === 'assistant' && message.message?.content) {
        for (const block of message.message.content) {
          if ('text' in block) {
            responses.push(block.text);
          }
        }
      }
    }

    return responses.join('\n');
  }

  /**
   * Create a new Claude Agent SDK session.
   */
  async createSession(config: AgentSessionConfig): Promise<AgentSession> {
    // Validate and map permission mode
    const permissionMode = this.validatePermissionMode(
      config.providerOptions?.permission_mode as string | undefined
    );

    // Generate unique session ID
    const sessionId = `claude-${Date.now()}-${this.sessionCounter++}`;

    // Track state for cancellation and completion
    let cancelled = false;
    let completionPromise: Promise<AgentResult> | null = null;

    // Start SDK query
    const sdkStream = query({
      prompt: config.prompt,
      options: {
        model: 'claude-sonnet-4-5-20250929',
        maxTurns: config.maxIterations || DEFAULT_MAX_ITERATIONS,
        allowedTools: config.allowedTools || Array.from(DEFAULT_ALLOWED_TOOLS),
        permissionMode: permissionMode as any,
      },
    });

    // Create completion promise
    completionPromise = this.waitForCompletion(sdkStream, sessionId, config.workingDirectory);

    return {
      id: sessionId,
      events: this.adaptStream(sdkStream, () => cancelled),
      wait: () => completionPromise!,
      cancel: async () => {
        cancelled = true;
        // SDK doesn't have a cancel method, so we rely on the adaptStream to stop yielding
      },
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
   * Adapt Claude Agent SDK messages to AgentEvent format.
   */
  private async *adaptStream(
    sdkStream: AsyncIterable<any>,
    isCancelled: () => boolean
  ): AsyncIterableIterator<AgentEvent> {
    try {
      for await (const message of sdkStream) {
        // Check if cancelled
        if (isCancelled()) {
          yield {
            type: 'complete',
            success: false,
          };
          return;
        }

        // Map SDK messages to AgentEvent format
        if (message.type === 'assistant' && message.message?.content) {
          for (const block of message.message.content) {
            if ('text' in block) {
              yield {
                type: 'text',
                content: block.text,
              };
            } else if ('thinking' in block) {
              yield {
                type: 'thinking',
                content: block.thinking,
              };
            } else if ('name' in block && 'input' in block) {
              // tool_use block
              yield {
                type: 'tool_use',
                tool: block.name,
                input: block.input,
              };
            }
          }
        } else if (message.type === 'tool_result') {
          yield {
            type: 'tool_result',
            tool: message.toolName || 'unknown',
            output: message.content,
            error: message.isError ? String(message.content) : undefined,
          };
        } else if (message.type === 'error') {
          yield {
            type: 'error',
            message: message.error?.message || 'Unknown error',
            fatal: message.fatal !== false,
          };
        } else if (message.type === 'result') {
          yield {
            type: 'complete',
            success: message.subtype === 'success',
          };
        }
      }
    } catch (error) {
      yield {
        type: 'error',
        message: error instanceof Error ? error.message : 'Stream processing error',
        fatal: true,
      };
      yield {
        type: 'complete',
        success: false,
      };
    }
  }

  /**
   * Wait for SDK session to complete and return result.
   */
  private async waitForCompletion(
    sdkStream: AsyncIterable<any>,
    sessionId: string,
    workingDirectory?: string
  ): Promise<AgentResult> {
    let success = false;
    let error: string | undefined;

    // Consume the stream to get the final result
    for await (const message of sdkStream) {
      if (message.type === 'result') {
        success = message.subtype === 'success';
        if (!success && message.error) {
          error = message.error.message || 'Session failed';
        }
      } else if (message.type === 'error') {
        error = message.error?.message || 'Unknown error';
      }
    }

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

    return {
      success,
      filesChanged,
      summary: success ? `Session ${sessionId} completed successfully` : `Session ${sessionId} failed`,
      error,
    };
  }
}
