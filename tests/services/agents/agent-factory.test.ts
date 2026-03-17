import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAgent } from '../../../src/services/agents/agent-factory.js';
import { ClaudeBinaryAgent } from '../../../src/services/agents/claude-binary.agent.js';
import { ClaudeSdkAgent } from '../../../src/services/agents/claude-sdk.agent.js';
import { RigConfig } from '../../../src/types/config.types.js';

// Mock both agent classes to avoid real construction side effects
vi.mock('../../../src/services/agents/claude-binary.agent.js', () => ({
  ClaudeBinaryAgent: vi.fn().mockImplementation(() => ({
    name: 'Claude Code (Binary)',
    _type: 'binary',
  })),
}));

vi.mock('../../../src/services/agents/claude-sdk.agent.js', () => ({
  ClaudeSdkAgent: vi.fn().mockImplementation(() => ({
    name: 'Claude Code (SDK)',
    _type: 'sdk',
  })),
}));

const buildConfig = (provider?: string): RigConfig => ({
  agent: { provider: provider as any, max_turns: 80 },
  queue: { default_phase: null, default_component: null },
  test: { require_new_tests: true },
  pr: { draft: false, reviewers: [] },
});

describe('createAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ClaudeBinaryAgent when provider is "binary"', () => {
    const agent = createAgent(buildConfig('binary'));
    expect(ClaudeBinaryAgent).toHaveBeenCalledWith(false, 120_000);
    expect((agent as any)._type).toBe('binary');
  });

  it('returns ClaudeSdkAgent when provider is "sdk"', () => {
    const agent = createAgent(buildConfig('sdk'));
    expect(ClaudeSdkAgent).toHaveBeenCalled();
    expect((agent as any)._type).toBe('sdk');
  });

  it('defaults to binary when provider is not specified', () => {
    const config = buildConfig();
    delete config.agent.provider;
    const agent = createAgent(config);
    expect(ClaudeBinaryAgent).toHaveBeenCalledWith(false, 120_000);
    expect((agent as any)._type).toBe('binary');
  });

  it('defaults to binary when config is undefined', () => {
    const agent = createAgent(undefined);
    expect(ClaudeBinaryAgent).toHaveBeenCalledWith(false, 120_000);
    expect((agent as any)._type).toBe('binary');
  });

  it('falls back to binary for unknown provider with warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const agent = createAgent(buildConfig('unknown'));
    expect(ClaudeBinaryAgent).toHaveBeenCalledWith(false, 120_000);
    expect((agent as any)._type).toBe('binary');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown agent provider'));
    warnSpy.mockRestore();
  });

  it('passes custom timeout to ClaudeBinaryAgent', () => {
    const config = buildConfig('binary');
    config.agent.timeout = 300;
    const agent = createAgent(config);
    expect(ClaudeBinaryAgent).toHaveBeenCalledWith(false, 300_000);
    expect((agent as any)._type).toBe('binary');
  });
});
