import { describe, it, expect } from 'vitest';
import { ClaudeCodeAgent } from '../../../src/services/agents/claude-code.agent.js';
import { ClaudeSdkAgent } from '../../../src/services/agents/claude-sdk.agent.js';

describe('ClaudeCodeAgent (backward-compat alias)', () => {
  it('is the same class as ClaudeSdkAgent', () => {
    expect(ClaudeCodeAgent).toBe(ClaudeSdkAgent);
  });

  it('creates an instance of ClaudeSdkAgent', () => {
    const agent = new ClaudeCodeAgent();
    expect(agent).toBeInstanceOf(ClaudeSdkAgent);
  });
});
