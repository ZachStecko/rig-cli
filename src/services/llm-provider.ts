import { RigConfig } from '../types/config.types.js';

/**
 * Authentication status for an LLM provider.
 */
export interface AuthStatus {
  /** Whether the provider is authenticated */
  authenticated: boolean;
  /** How the provider is authenticated */
  method?: 'api_key';
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

/** Per-call options every API provider accepts. */
export interface ApiProviderOptions {
  /** Model ID to request; falls back to the provider's default */
  model?: string;
  /** Milliseconds before a prompt call is aborted; <= 0 disables (default: 120s) */
  timeoutMs?: number;
}

/** Vendor-specific settings a subclass passes to the base constructor. */
interface ApiProviderSettings {
  name: string;
  baseUrl: string;
  apiKeyEnvVar: string;
  model: string;
  timeoutMs?: number;
}

/**
 * Base class for providers that speak the OpenAI chat-completions protocol.
 *
 * Most model vendors (Moonshot/Kimi, DeepSeek, OpenAI, ...) expose this
 * request/response shape, so adding a vendor is a small subclass that
 * supplies a name, base URL, API-key env var, and default model.
 */
export class OpenAICompatProvider implements LLMProvider {
  readonly name: string;
  private baseUrl: string;
  private apiKeyEnvVar: string;
  private model: string;
  private timeoutMs: number;

  constructor(settings: ApiProviderSettings) {
    this.name = settings.name;
    this.baseUrl = settings.baseUrl.replace(/\/$/, '');
    this.apiKeyEnvVar = settings.apiKeyEnvVar;
    this.model = settings.model;
    this.timeoutMs = settings.timeoutMs ?? 120_000;
  }

  private get apiKey(): string | undefined {
    return process.env[this.apiKeyEnvVar];
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }

  async checkAuth(): Promise<AuthStatus> {
    if (this.apiKey) {
      return { authenticated: true, method: 'api_key' };
    }
    return {
      authenticated: false,
      error: `Not authenticated. Set the ${this.apiKeyEnvVar} environment variable`,
    };
  }

  async prompt(text: string): Promise<string> {
    const auth = await this.checkAuth();
    if (!auth.authenticated) {
      throw new Error(auth.error);
    }

    const controller = new AbortController();
    const timer = this.timeoutMs > 0
      ? setTimeout(() => controller.abort(), this.timeoutMs)
      : null;

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: text }],
          max_tokens: 16384,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        const detail = body.trim().slice(0, 500) || response.statusText;
        throw new Error(`${this.name} API error (HTTP ${response.status}): ${detail}`);
      }

      const data = (await response.json()) as {
        choices?: { message?: { content?: string }; finish_reason?: string }[];
      };
      const choice = data.choices?.[0];
      if (choice?.finish_reason === 'length') {
        throw new Error(`${this.name} response was truncated at the max_tokens limit`);
      }
      const content = choice?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        throw new Error(`${this.name} returned an empty response`);
      }
      return content;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`${this.name} prompt timed out after ${this.timeoutMs / 1000}s`);
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

/**
 * Groq's hosted open models via the OpenAI-compatible API.
 *
 * Requires the GROQ_API_KEY environment variable
 * (create a key at https://console.groq.com).
 */
export class GroqProvider extends OpenAICompatProvider {
  static readonly DEFAULT_MODEL = 'openai/gpt-oss-120b';

  constructor(options?: ApiProviderOptions) {
    super({
      name: 'Groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKeyEnvVar: 'GROQ_API_KEY',
      model: options?.model ?? GroqProvider.DEFAULT_MODEL,
      timeoutMs: options?.timeoutMs,
    });
  }
}

/**
 * Moonshot AI's Kimi models via the platform API.
 *
 * Requires the MOONSHOT_API_KEY environment variable
 * (create a key at https://platform.moonshot.ai).
 */
export class KimiProvider extends OpenAICompatProvider {
  static readonly DEFAULT_MODEL = 'kimi-k3';

  constructor(options?: ApiProviderOptions) {
    super({
      name: 'Kimi',
      baseUrl: 'https://api.moonshot.ai/v1',
      apiKeyEnvVar: 'MOONSHOT_API_KEY',
      model: options?.model ?? KimiProvider.DEFAULT_MODEL,
      timeoutMs: options?.timeoutMs,
    });
  }
}

/**
 * Creates an LLM provider based on the provider setting in config.
 *
 * @param config - Optional RigConfig; defaults to 'groq' provider if omitted
 * @returns An LLMProvider matching the configured provider
 */
export function createProvider(config?: RigConfig): LLMProvider {
  const provider = config?.agent?.provider ?? 'groq';
  const options: ApiProviderOptions = {
    model: config?.agent?.model,
    timeoutMs: (config?.agent?.timeout ?? 120) * 1000,
  };
  switch (provider) {
    case 'groq':
      return new GroqProvider(options);
    case 'kimi':
      return new KimiProvider(options);
    default:
      console.warn(`Unknown agent provider: ${provider}. Falling back to 'groq'.`);
      return new GroqProvider(options);
  }
}
