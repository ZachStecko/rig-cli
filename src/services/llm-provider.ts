import { query } from '@anthropic-ai/claude-agent-sdk';
import { ClaudeService } from './claude.service.js';
import { RigConfig } from '../types/config.types.js';

/**
 * Authentication status for an LLM provider.
 */
export interface AuthStatus {
  /** Whether the provider is authenticated */
  authenticated: boolean;
  /** How the provider is authenticated */
  method?: 'api_key' | 'subscription';
  /** Error message if not authenticated */
  error?: string;
}

/**
 * A provider that can answer one-shot text prompts.
 *
 * rig-cli uses LLM calls only for text generation (issue bodies,
 * spec decomposition). Implementation work is done by the user with
 * their own coding tool, so no agentic session support is needed.
 */
export interface LLMProvider {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  checkAuth(): Promise<AuthStatus>;
  prompt(text: string): Promise<string>;
}

/**
 * LLM provider backed by the Claude Code CLI (`claude` binary).
 *
 * Works with a Claude subscription at no extra API cost.
 */
export class BinaryProvider implements LLMProvider {
  readonly name = 'Claude CLI';

  private claudeService: ClaudeService;
  private verbose: boolean;
  private timeoutMs: number;

  constructor(verbose?: boolean, timeoutMs?: number) {
    this.claudeService = new ClaudeService();
    this.verbose = verbose ?? false;
    this.timeoutMs = timeoutMs ?? 120_000;
  }

  async isAvailable(): Promise<boolean> {
    return this.claudeService.isInstalled();
  }

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

  async prompt(text: string): Promise<string> {
    return this.claudeService.prompt(text, {
      verbose: this.verbose,
      timeoutMs: this.timeoutMs,
    });
  }
}

const SDK_MODEL = 'claude-sonnet-4-5-20250929';

/**
 * LLM provider backed by the Claude Agent SDK.
 *
 * Requires the ANTHROPIC_API_KEY environment variable.
 */
export class SdkProvider implements LLMProvider {
  readonly name = 'Claude SDK';

  async isAvailable(): Promise<boolean> {
    return !!process.env.ANTHROPIC_API_KEY;
  }

  async checkAuth(): Promise<AuthStatus> {
    if (process.env.ANTHROPIC_API_KEY) {
      return { authenticated: true, method: 'api_key' };
    }

    return {
      authenticated: false,
      error: 'Not authenticated. Set ANTHROPIC_API_KEY environment variable',
    };
  }

  async prompt(text: string): Promise<string> {
    const responses: string[] = [];

    for await (const message of query({
      prompt: text,
      options: {
        model: SDK_MODEL,
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
}

/**
 * Creates an LLM provider based on the provider setting in config.
 *
 * @param config - Optional RigConfig; defaults to 'binary' provider if omitted
 * @returns An LLMProvider matching the configured provider
 */
export function createProvider(config?: RigConfig): LLMProvider {
  const provider = config?.agent?.provider ?? 'binary';
  const verbose = config?.verbose ?? false;
  const timeoutMs = (config?.agent?.timeout ?? 120) * 1000;
  switch (provider) {
    case 'binary':
      return new BinaryProvider(verbose, timeoutMs);
    case 'sdk':
      return new SdkProvider();
    default:
      console.warn(`Unknown agent provider: ${provider}. Falling back to 'binary'.`);
      return new BinaryProvider(verbose, timeoutMs);
  }
}
