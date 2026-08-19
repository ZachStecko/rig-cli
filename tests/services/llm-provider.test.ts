import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { KimiProvider, createProvider } from '../../src/services/llm-provider.js';
import { RigConfig } from '../../src/types/config.types.js';

describe('llm-provider', () => {
  const originalKey = process.env.MOONSHOT_API_KEY;

  beforeEach(() => {
    process.env.MOONSHOT_API_KEY = 'test-key';
  });

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.MOONSHOT_API_KEY;
    } else {
      process.env.MOONSHOT_API_KEY = originalKey;
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function stubFetchResponse(body: unknown, init?: { ok?: boolean; status?: number; statusText?: string }) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: init?.ok ?? true,
      status: init?.status ?? 200,
      statusText: init?.statusText ?? 'OK',
      json: async () => body,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  describe('KimiProvider auth', () => {
    it('is available when MOONSHOT_API_KEY is set', async () => {
      const provider = new KimiProvider();
      expect(await provider.isAvailable()).toBe(true);
      expect(await provider.checkAuth()).toEqual({ authenticated: true, method: 'api_key' });
    });

    it('is not available without MOONSHOT_API_KEY', async () => {
      delete process.env.MOONSHOT_API_KEY;
      const provider = new KimiProvider();
      expect(await provider.isAvailable()).toBe(false);
      const auth = await provider.checkAuth();
      expect(auth.authenticated).toBe(false);
      expect(auth.error).toContain('MOONSHOT_API_KEY');
    });

    it('prompt throws without an API key', async () => {
      delete process.env.MOONSHOT_API_KEY;
      const provider = new KimiProvider();
      await expect(provider.prompt('hi')).rejects.toThrow('MOONSHOT_API_KEY');
    });
  });

  describe('KimiProvider prompt', () => {
    it('sends a chat-completions request and returns the message content', async () => {
      const fetchMock = stubFetchResponse({
        choices: [{ message: { content: '{"title":"t","body":"b"}' } }],
      });

      const provider = new KimiProvider();
      const result = await provider.prompt('structure this');

      expect(result).toBe('{"title":"t","body":"b"}');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, request] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.moonshot.ai/v1/chat/completions');
      expect(request.headers.Authorization).toBe('Bearer test-key');
      const payload = JSON.parse(request.body);
      expect(payload.model).toBe('kimi-k3');
      expect(payload.messages).toEqual([{ role: 'user', content: 'structure this' }]);
    });

    it('uses a custom model when provided', async () => {
      const fetchMock = stubFetchResponse({ choices: [{ message: { content: 'ok' } }] });

      const provider = new KimiProvider({ model: 'kimi-k2.6' });
      await provider.prompt('hi');

      const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(payload.model).toBe('kimi-k2.6');
    });

    it('throws with status and detail on HTTP errors', async () => {
      stubFetchResponse({ error: { message: 'insufficient balance' } }, {
        ok: false,
        status: 402,
        statusText: 'Payment Required',
      });

      const provider = new KimiProvider();
      await expect(provider.prompt('hi')).rejects.toThrow(/Kimi API error \(HTTP 402\).*insufficient balance/);
    });

    it('throws when the response has no message content', async () => {
      stubFetchResponse({ choices: [{ message: { content: '' } }] });

      const provider = new KimiProvider();
      await expect(provider.prompt('hi')).rejects.toThrow('Kimi returned an empty response');
    });

    it('maps an aborted request to a timeout error', async () => {
      const abortError = new Error('This operation was aborted');
      abortError.name = 'AbortError';
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

      const provider = new KimiProvider({ timeoutMs: 5000 });
      await expect(provider.prompt('hi')).rejects.toThrow('Kimi prompt timed out after 5s');
    });
  });

  describe('createProvider', () => {
    it('defaults to the Kimi provider', () => {
      const provider = createProvider();
      expect(provider).toBeInstanceOf(KimiProvider);
      expect(provider.name).toBe('Kimi');
    });

    it('creates a Kimi provider from config', () => {
      const config = { agent: { provider: 'kimi', timeout: 60 }, git: {} } as RigConfig;
      expect(createProvider(config)).toBeInstanceOf(KimiProvider);
    });

    it('falls back to Kimi with a warning on unknown providers', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const config = { agent: { provider: 'binary' }, git: {} } as unknown as RigConfig;

      const provider = createProvider(config);

      expect(provider).toBeInstanceOf(KimiProvider);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Unknown agent provider: binary'));
    });

    it('passes the configured model through', async () => {
      const fetchMock = stubFetchResponse({ choices: [{ message: { content: 'ok' } }] });
      const config = { agent: { provider: 'kimi', model: 'kimi-k2.7-code' }, git: {} } as RigConfig;

      const provider = createProvider(config);
      await provider.prompt('hi');

      const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(payload.model).toBe('kimi-k2.7-code');
    });
  });
});
