import { describe, it, expect } from 'vitest';
import { STAGE_ORDER, INITIAL_STAGES } from '../../src/types/state.types.js';
import { DEFAULT_CONFIG } from '../../src/types/config.types.js';

describe('STAGE_ORDER', () => {
  it('has 7 stages in pipeline order', () => {
    expect(STAGE_ORDER).toEqual(['pick', 'branch', 'implement', 'test', 'demo', 'pr', 'review']);
  });
});

describe('INITIAL_STAGES', () => {
  it('all stages start as pending', () => {
    for (const stage of STAGE_ORDER) {
      expect(INITIAL_STAGES[stage]).toBe('pending');
    }
  });
});

describe('DEFAULT_CONFIG', () => {
  it('has expected default values', () => {
    expect(DEFAULT_CONFIG.agent.max_turns).toBe(80);
    expect(DEFAULT_CONFIG.queue.default_phase).toBeNull();
    expect(DEFAULT_CONFIG.queue.default_component).toBeNull();
    expect(DEFAULT_CONFIG.test.require_new_tests).toBe(true);
    expect(DEFAULT_CONFIG.demo.enabled).toBe(true);
    expect(DEFAULT_CONFIG.pr.draft).toBe(false);
    expect(DEFAULT_CONFIG.pr.reviewers).toEqual([]);
  });
});
