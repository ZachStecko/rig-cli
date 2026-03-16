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
const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';
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
export class ClaudeSdkAgent extends CodeAgent {
  readonly name = 'Claude Code (SDK)';

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
        model: DEFAULT_MODEL,
        maxTurns: 1,
        tools: [],
        permissionMode: 'bypassPermissions' as any,
        allowDangerouslySkipPermissions: true,
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
      config.providerOptions?.permissionMode as string | undefined
    );

    // Generate unique session ID
    const sessionId = `claude-${Date.now()}-${this.sessionCounter++}`;

    // Track state for cancellation and completion
    let cancelled = false;

    // Completion tracking — resolved when adaptStream finishes
    let result: AgentResult = {
      success: false,
      filesChanged: [],
      summary: `Session ${sessionId} failed`,
    };
    let resolveCompletion: (value: AgentResult) => void;
    const completionPromise = new Promise<AgentResult>((resolve) => {
      resolveCompletion = resolve;
    });

    // Start SDK query
    const sdkStream = query({
      prompt: config.prompt,
      options: {
        model: DEFAULT_MODEL,
        maxTurns: config.maxIterations || DEFAULT_MAX_ITERATIONS,
        allowedTools: config.allowedTools || Array.from(DEFAULT_ALLOWED_TOOLS),
        permissionMode: permissionMode as any,
        ...(permissionMode === 'bypassPermissions' ? { allowDangerouslySkipPermissions: true } : {}),
        ...(config.verbose ? { verbose: true } : {}),
      },
    });

    // Log session config when verbose
    if (config.verbose) {
      console.error(`[verbose] Session ${sessionId}: model=${DEFAULT_MODEL} maxTurns=${config.maxIterations || DEFAULT_MAX_ITERATIONS} permissionMode=${permissionMode}`);
      // Note: SDK does not support logFile directly; logging is handled by the caller
      if (config.logFile) {
        console.error(`[verbose] logFile requested but not supported by SDK: ${config.logFile}`);
      }
    }

    return {
      id: sessionId,
      events: this.adaptStream(sdkStream, () => cancelled, (success) => {
        result = {
          success,
          filesChanged: [],
          summary: success ? `Session ${sessionId} completed successfully` : `Session ${sessionId} failed`,
        };
        resolveCompletion!(result);
      }),
      wait: () => completionPromise,
      cancel: async () => {
        cancelled = true;
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
   *
   * Tracks completion state and calls onComplete when the stream finishes.
   */
  private async *adaptStream(
    sdkStream: AsyncIterable<any>,
    isCancelled: () => boolean,
    onComplete: (success: boolean) => void
  ): AsyncIterableIterator<AgentEvent> {
    let success = false;

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
          success = message.subtype === 'success';
          yield {
            type: 'complete',
            success,
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
    } finally {
      onComplete(success);
    }
  }
}
