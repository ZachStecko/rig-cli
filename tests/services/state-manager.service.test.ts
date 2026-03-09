import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StateManager } from '../../src/services/state-manager.service.js';
import { PipelineState, INITIAL_STAGES } from '../../src/types/state.types.js';
import { mkdir, rm, access } from 'fs/promises';
import { resolve } from 'path';
import { tmpdir } from 'os';

describe('StateManager', () => {
  let tempDir: string;
  let stateManager: StateManager;
  let mockState: PipelineState;

  beforeEach(async () => {
    // Create unique temp directory
    tempDir = resolve(tmpdir(), `rig-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
    await mkdir(tempDir, { recursive: true });
    stateManager = new StateManager(tempDir);

    // Create a mock state for testing
    mockState = {
      issue_number: 123,
      issue_title: 'Fix authentication bug',
      branch: 'issue-123-fix-authentication-bug',
      stage: 'implement',
      stages: { ...INITIAL_STAGES },
    };
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('exists', () => {
    it('returns false when state file does not exist', async () => {
      expect(await stateManager.exists()).toBe(false);
    });

    it('returns true when state file exists', async () => {
      await stateManager.write(mockState);
      expect(await stateManager.exists()).toBe(true);
    });
  });

  describe('write', () => {
    it('writes state to .rig-state.json', async () => {
      await stateManager.write(mockState);
      expect(await stateManager.exists()).toBe(true);
    });

    it('creates valid JSON file', async () => {
      await stateManager.write(mockState);
      const state = await stateManager.read();
      expect(state).toEqual(mockState);
    });

    it('overwrites existing state', async () => {
      await stateManager.write(mockState);

      const newState = { ...mockState, issue_number: 456 };
      await stateManager.write(newState);

      const state = await stateManager.read();
      expect(state.issue_number).toBe(456);
    });
  });

  describe('read', () => {
    it('reads state from .rig-state.json', async () => {
      await stateManager.write(mockState);
      const state = await stateManager.read();
      expect(state).toEqual(mockState);
    });

    it('throws when state file does not exist', async () => {
      await expect(stateManager.read()).rejects.toThrow();
    });

    it('throws when state file contains invalid JSON', async () => {
      const statePath = stateManager.getStatePath();
      const fs = await import('fs/promises');
      await fs.writeFile(statePath, 'invalid json{', 'utf-8');

      await expect(stateManager.read()).rejects.toThrow();
    });

    it('returns a clone to prevent mutation', async () => {
      await stateManager.write(mockState);

      const state1 = await stateManager.read();
      state1.issue_number = 999;
      state1.stages.implement = 'failed';

      const state2 = await stateManager.read();
      expect(state2.issue_number).toBe(123);
      expect(state2.stages.implement).toBe('pending');
    });
  });

  describe('readField', () => {
    it('reads issue_number field', async () => {
      await stateManager.write(mockState);
      const issueNumber = await stateManager.readField('issue_number');
      expect(issueNumber).toBe(123);
    });

    it('reads issue_title field', async () => {
      await stateManager.write(mockState);
      const title = await stateManager.readField('issue_title');
      expect(title).toBe('Fix authentication bug');
    });

    it('reads branch field', async () => {
      await stateManager.write(mockState);
      const branch = await stateManager.readField('branch');
      expect(branch).toBe('issue-123-fix-authentication-bug');
    });

    it('reads stage field', async () => {
      await stateManager.write(mockState);
      const stage = await stateManager.readField('stage');
      expect(stage).toBe('implement');
    });

    it('reads stages field', async () => {
      await stateManager.write(mockState);
      const stages = await stateManager.readField('stages');
      expect(stages).toEqual(INITIAL_STAGES);
    });

    it('throws when state file does not exist', async () => {
      await expect(stateManager.readField('issue_number')).rejects.toThrow();
    });
  });

  describe('updateStage', () => {
    beforeEach(async () => {
      await stateManager.write(mockState);
    });

    it('updates stage status', async () => {
      await stateManager.updateStage('implement', 'completed');

      const state = await stateManager.read();
      expect(state.stages.implement).toBe('completed');
    });

    it('updates current stage when marking in_progress', async () => {
      await stateManager.updateStage('test', 'in_progress');

      const state = await stateManager.read();
      expect(state.stage).toBe('test');
      expect(state.stages.test).toBe('in_progress');
    });

    it('updates current stage when marking completed', async () => {
      await stateManager.updateStage('pr', 'completed');

      const state = await stateManager.read();
      expect(state.stage).toBe('pr');
      expect(state.stages.pr).toBe('completed');
    });

    it('does not update current stage when marking failed', async () => {
      await stateManager.updateStage('test', 'failed');

      const state = await stateManager.read();
      expect(state.stage).toBe('implement'); // Original stage
      expect(state.stages.test).toBe('failed');
    });

    it('does not update current stage when marking pending', async () => {
      mockState.stage = 'test';
      await stateManager.write(mockState);

      await stateManager.updateStage('implement', 'pending');

      const state = await stateManager.read();
      expect(state.stage).toBe('test'); // Original stage
      expect(state.stages.implement).toBe('pending');
    });

    it('updates multiple stages sequentially', async () => {
      await stateManager.updateStage('implement', 'completed');
      await stateManager.updateStage('test', 'in_progress');
      await stateManager.updateStage('test', 'completed');

      const state = await stateManager.read();
      expect(state.stages.implement).toBe('completed');
      expect(state.stages.test).toBe('completed');
      expect(state.stage).toBe('test');
    });

    it('throws when state file does not exist', async () => {
      await stateManager.delete();
      await expect(stateManager.updateStage('implement', 'completed')).rejects.toThrow();
    });
  });

  describe('delete', () => {
    it('deletes existing state file', async () => {
      await stateManager.write(mockState);
      expect(await stateManager.exists()).toBe(true);

      await stateManager.delete();
      expect(await stateManager.exists()).toBe(false);
    });

    it('does not throw when state file does not exist (idempotent)', async () => {
      await expect(stateManager.delete()).resolves.not.toThrow();
    });

    it('can be called multiple times', async () => {
      await stateManager.write(mockState);
      await stateManager.delete();
      await stateManager.delete(); // Second call should not throw
      expect(await stateManager.exists()).toBe(false);
    });
  });

  describe('ensureDirs', () => {
    it('creates .rig-logs directory', async () => {
      await stateManager.ensureDirs();
      const logsDir = resolve(tempDir, '.rig-logs');
      await expect(access(logsDir)).resolves.not.toThrow();
    });

    it('creates .rig-demos directory', async () => {
      await stateManager.ensureDirs();
      const demosDir = resolve(tempDir, '.rig-demos');
      await expect(access(demosDir)).resolves.not.toThrow();
    });

    it('creates .rig-reviews directory', async () => {
      await stateManager.ensureDirs();
      const reviewsDir = resolve(tempDir, '.rig-reviews');
      await expect(access(reviewsDir)).resolves.not.toThrow();
    });

    it('is idempotent (can be called multiple times)', async () => {
      await stateManager.ensureDirs();
      await stateManager.ensureDirs(); // Should not throw
      await stateManager.ensureDirs();

      const logsDir = resolve(tempDir, '.rig-logs');
      await expect(access(logsDir)).resolves.not.toThrow();
    });

    it('creates all three directories', async () => {
      await stateManager.ensureDirs();

      const logsDir = resolve(tempDir, '.rig-logs');
      const demosDir = resolve(tempDir, '.rig-demos');
      const reviewsDir = resolve(tempDir, '.rig-reviews');

      await expect(access(logsDir)).resolves.not.toThrow();
      await expect(access(demosDir)).resolves.not.toThrow();
      await expect(access(reviewsDir)).resolves.not.toThrow();
    });
  });

  describe('getStatePath', () => {
    it('returns the state file path', () => {
      const path = stateManager.getStatePath();
      expect(path).toBe(resolve(tempDir, '.rig-state.json'));
    });
  });

  describe('integration: write/read roundtrip', () => {
    it('preserves all state fields', async () => {
      const complexState: PipelineState = {
        issue_number: 456,
        issue_title: 'Add new feature with special chars: @#$%',
        branch: 'issue-456-add-new-feature-with-special-chars',
        stage: 'review',
        stages: {
          pick: 'completed',
          branch: 'completed',
          implement: 'completed',
          test: 'completed',
          demo: 'completed',
          pr: 'completed',
          review: 'in_progress',
        },
      };

      await stateManager.write(complexState);
      const retrieved = await stateManager.read();

      expect(retrieved).toEqual(complexState);
    });

    it('handles state with all stages failed', async () => {
      mockState.stages = {
        pick: 'failed',
        branch: 'failed',
        implement: 'failed',
        test: 'failed',
        demo: 'failed',
        pr: 'failed',
        review: 'failed',
      };

      await stateManager.write(mockState);
      const retrieved = await stateManager.read();

      expect(retrieved.stages).toEqual(mockState.stages);
    });
  });
});
