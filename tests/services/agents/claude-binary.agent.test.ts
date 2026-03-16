import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClaudeBinaryAgent } from '../../../src/services/agents/claude-binary.agent.js';

// Mock ClaudeService
const mockClaudeService = {
  isInstalled: vi.fn(),
  prompt: vi.fn(),
  run: vi.fn(),
};

vi.mock('../../../src/services/claude.service.js', () => ({
  ClaudeService: vi.fn(() => mockClaudeService),
}));

describe('ClaudeBinaryAgent', () => {
  let agent: ClaudeBinaryAgent;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = new ClaudeBinaryAgent();
  });

  describe('constructor', () => {
    it('creates agent with correct name', () => {
      expect(agent.name).toBe('Claude Code (Binary)');
    });

    it('declares all capabilities', () => {
      expect(agent.capabilities.fileOperations).toBe(true);
      expect(agent.capabilities.shellExecution).toBe(true);
      expect(agent.capabilities.codeSearch).toBe(true);
      expect(agent.capabilities.structuredStreaming).toBe(true);
      expect(agent.capabilities.toolPermissions).toBe(true);
      expect(agent.capabilities.maxIterations).toBe(true);
      expect(agent.capabilities.webSearch).toBe(true);
    });
  });

  describe('isAvailable', () => {
    it('delegates to ClaudeService.isInstalled', async () => {
      mockClaudeService.isInstalled.mockResolvedValue(true);
      const available = await agent.isAvailable();
      expect(available).toBe(true);
      expect(mockClaudeService.isInstalled).toHaveBeenCalled();
    });

    it('returns false when CLI is not installed', async () => {
      mockClaudeService.isInstalled.mockResolvedValue(false);
      const available = await agent.isAvailable();
      expect(available).toBe(false);
    });
  });

  describe('checkAuth', () => {
    it('returns api_key method when ANTHROPIC_API_KEY is set', async () => {
      const originalApiKey = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'test-api-key';

      const auth = await agent.checkAuth();

      expect(auth.authenticated).toBe(true);
      expect(auth.method).toBe('api_key');

      if (originalApiKey) {
        process.env.ANTHROPIC_API_KEY = originalApiKey;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    });

    it('returns subscription method when CLI is installed', async () => {
      const originalApiKey = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;

      mockClaudeService.isInstalled.mockResolvedValue(true);
      const auth = await agent.checkAuth();

      expect(auth.authenticated).toBe(true);
      expect(auth.method).toBe('subscription');

      if (originalApiKey) {
        process.env.ANTHROPIC_API_KEY = originalApiKey;
      }
    });

    it('returns not authenticated when neither is available', async () => {
      const originalApiKey = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;

      mockClaudeService.isInstalled.mockResolvedValue(false);
      const auth = await agent.checkAuth();

      expect(auth.authenticated).toBe(false);
      expect(auth.error).toBeDefined();

      if (originalApiKey) {
        process.env.ANTHROPIC_API_KEY = originalApiKey;
      }
    });
  });

  describe('prompt', () => {
    it('delegates to ClaudeService.prompt', async () => {
      mockClaudeService.prompt.mockResolvedValue('response text');
      const result = await agent.prompt('test prompt');
      expect(result).toBe('response text');
      expect(mockClaudeService.prompt).toHaveBeenCalledWith('test prompt', { verbose: false });
    });
  });

  describe('createSession', () => {
    it('calls ClaudeService.run with correct options', async () => {
      const { EventEmitter } = await import('events');
      const mockChild = new EventEmitter() as any;
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      mockChild.kill = vi.fn();

      mockClaudeService.run.mockResolvedValue(mockChild);

      const session = await agent.createSession({
        prompt: 'test prompt',
        maxIterations: 10,
        allowedTools: ['Read', 'Write'],
        providerOptions: { permissionMode: 'bypassPermissions' },
      });

      expect(session).toHaveProperty('id');
      expect(session).toHaveProperty('events');
      expect(session).toHaveProperty('wait');
      expect(session).toHaveProperty('cancel');
      expect(typeof session.id).toBe('string');
      expect(session.id).toMatch(/^claude-\d+-\d+$/);

      expect(mockClaudeService.run).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'test prompt',
          maxTurns: 10,
          allowedTools: 'Read,Write',
          permissionMode: 'bypassPermissions',
        })
      );

      // Clean up - emit exit to resolve promises
      mockChild.emit('exit', 0);
    });

    it('cancel sends SIGTERM to process', async () => {
      const { EventEmitter } = await import('events');
      const mockChild = new EventEmitter() as any;
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      mockChild.kill = vi.fn().mockImplementation((signal) => {
        if (signal === 'SIGTERM') {
          mockChild.emit('exit', 0);
        }
      });

      mockClaudeService.run.mockResolvedValue(mockChild);

      const session = await agent.createSession({
        prompt: 'test prompt',
      });

      await session.cancel();

      expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');
    });
  });
});
