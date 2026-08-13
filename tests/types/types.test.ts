import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/types/config.types.js';

describe('DEFAULT_CONFIG', () => {
  it('has expected default values', () => {
    expect(DEFAULT_CONFIG.agent.provider).toBe('kimi');
    expect(DEFAULT_CONFIG.agent.timeout).toBe(120);
    expect(DEFAULT_CONFIG.git).toEqual({});
    expect(DEFAULT_CONFIG.verbose).toBe(false);
  });
});
