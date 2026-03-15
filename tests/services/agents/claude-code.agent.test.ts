import { describe, it, expect } from 'vitest';
import { ClaudeCodeAgent } from '../../../src/services/agents/claude-code.agent.js';

describe('ClaudeCodeAgent', () => {
  describe('constructor', () => {
    it('creates agent with correct name', () => {
      const agent = new ClaudeCodeAgent();
      expect(agent.name).toBe('Claude Code');
    });

    it('declares all capabilities', () => {
      const agent = new ClaudeCodeAgent();

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
    it('returns boolean', async () => {
      const agent = new ClaudeCodeAgent();
      const available = await agent.isAvailable();

      expect(typeof available).toBe('boolean');
    });
  });

  describe('checkAuth', () => {
    it('returns authentication status', async () => {
      const agent = new ClaudeCodeAgent();
      const auth = await agent.checkAuth();

      expect(auth).toHaveProperty('authenticated');
      expect(typeof auth.authenticated).toBe('boolean');
    });

    it('detects API key authentication', async () => {
      const originalApiKey = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'test-api-key';

      const agent = new ClaudeCodeAgent();
      const auth = await agent.checkAuth();

      expect(auth.authenticated).toBe(true);
      expect(auth.method).toBe('api_key');

      // Restore
      if (originalApiKey) {
        process.env.ANTHROPIC_API_KEY = originalApiKey;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    });
  });

  describe('createSession', () => {
    it('returns a session object with correct structure', async () => {
      const agent = new ClaudeCodeAgent();

      // Skip if Claude CLI not installed
      const available = await agent.isAvailable();
      if (!available) {
        console.log('Skipping createSession test - Claude CLI not installed');
        return;
      }

      const session = await agent.createSession({
        prompt: 'test prompt',
        maxIterations: 1,
        allowedTools: ['Read'],
      });

      expect(session).toHaveProperty('id');
      expect(session).toHaveProperty('events');
      expect(session).toHaveProperty('wait');
      expect(session).toHaveProperty('cancel');
      expect(typeof session.id).toBe('string');
      expect(session.id).toMatch(/^claude-\d+-\d+$/);

      // Cancel immediately to avoid running a real session
      await session.cancel();
    });
  });
});
