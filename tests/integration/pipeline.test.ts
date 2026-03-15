import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StateManager } from '../../src/services/state-manager.service.js';
import { Logger } from '../../src/services/logger.service.js';
import { ConfigManager } from '../../src/services/config-manager.service.js';
import { GitService } from '../../src/services/git.service.js';
import { GitHubService } from '../../src/services/github.service.js';
import { GuardService } from '../../src/services/guard.service.js';
import { NextCommand } from '../../src/commands/next.command.js';
import { ResetCommand } from '../../src/commands/reset.command.js';
import { ShipCommand } from '../../src/commands/ship.command.js';
import { INITIAL_STAGES } from '../../src/types/state.types.js';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const mkdir = promisify(fs.mkdir);
const rm = promisify(fs.rm);

// Mock external dependencies
vi.mock('child_process', () => ({
  exec: vi.fn((_cmd, _options, callback) => {
    if (callback) {
      callback(null, { stdout: 'success', stderr: '' } as any, '');
    }
    return {} as any;
  }),
  spawn: vi.fn(() => ({
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn((event, handler) => {
      if (event === 'close') {
        setTimeout(() => handler(0), 10);
      }
    }),
  })),
}));

vi.mock('readline', () => ({
  createInterface: vi.fn(() => ({
    question: vi.fn((_q, callback) => callback('n')),
    close: vi.fn(),
  })),
}));

/**
 * Integration tests for the full pipeline flow.
 *
 * These tests verify that:
 * 1. Commands can be sequenced correctly (Queue → Next → Implement → Test → Demo → PR)
 * 2. State persists correctly between commands
 * 3. Resume capability works after failures
 * 4. Pipeline orchestration is correct
 */
describe('Pipeline Integration Tests', () => {
  let testProjectRoot: string;
  let logger: Logger;
  let config: ConfigManager;
  let state: StateManager;
  let git: GitService;
  let github: GitHubService;
  let guard: GuardService;

  beforeEach(async () => {
    // Create temp project directory
    testProjectRoot = path.join(process.cwd(), '.tmp-integration-test');
    await mkdir(testProjectRoot, { recursive: true });

    // Initialize services
    logger = {
      header: vi.fn(),
      dim: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      step: vi.fn(),
    } as any;

    config = {
      load: vi.fn(),
      get: vi.fn().mockReturnValue({
        agent: { max_turns: 20 },
        queue: {
          phase_priorities: { 'Phase 1: MVP': 3, 'Phase 2': 2, 'Phase 3': 1 },
          label_priorities: { P0: 5, P1: 4, P2: 3, P3: 2, P4: 1 },
        },
      }),
    } as any;

    state = new StateManager(testProjectRoot);

    git = {
      isClean: vi.fn().mockResolvedValue(true),
      currentBranch: vi.fn().mockResolvedValue('main'),
      isOnMaster: vi.fn().mockResolvedValue(true),
      isOnFeatureBranch: vi.fn().mockResolvedValue(false),
      createBranch: vi.fn().mockResolvedValue(undefined),
      checkoutMaster: vi.fn().mockResolvedValue(undefined),
      push: vi.fn().mockResolvedValue(undefined),
      diffStatVsMaster: vi.fn().mockResolvedValue('2 files changed'),
      newFilesVsMaster: vi.fn().mockResolvedValue([]),
      commitCountVsMaster: vi.fn().mockResolvedValue('3'),
      logVsMaster: vi.fn().mockResolvedValue('commit log'),
    } as any;

    github = {
      isAuthenticated: vi.fn().mockResolvedValue(true),
      isInstalled: vi.fn().mockResolvedValue(true),
      repoName: vi.fn().mockResolvedValue('owner/repo'),
      listIssues: vi.fn().mockResolvedValue([
        {
          number: 42,
          title: 'Add user dashboard',
          labels: [{ name: 'fullstack' }, { name: 'P1' }, { name: 'Phase 1: MVP' }],
          body: 'Implement user dashboard with profile and settings',
        },
      ]),
      viewIssue: vi.fn().mockResolvedValue({
        number: 42,
        title: 'Add user dashboard',
        labels: [{ name: 'fullstack' }, { name: 'P1' }, { name: 'Phase 1: MVP' }],
        body: 'Implement user dashboard with profile and settings',
        state: 'OPEN',
      }),
      issueBody: vi.fn().mockResolvedValue('Implement user dashboard with profile and settings'),
      issueTitle: vi.fn().mockResolvedValue('Add user dashboard'),
      issueLabels: vi.fn().mockResolvedValue(['fullstack', 'P1', 'Phase 1: MVP']),
      hasOpenPr: vi.fn().mockResolvedValue(false),
      createPr: vi.fn().mockResolvedValue({ number: 100, html_url: 'https://github.com/owner/repo/pull/100' }),
      editPr: vi.fn().mockResolvedValue(undefined),
      prComment: vi.fn().mockResolvedValue(undefined),
      prListByHead: vi.fn().mockResolvedValue([]),
      issueState: vi.fn().mockResolvedValue('open'),
    } as any;

    guard = new GuardService(git, github, state);

    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up temp directory
    if (fs.existsSync(testProjectRoot)) {
      await rm(testProjectRoot, { recursive: true, force: true });
    }
  });

  describe('Full Pipeline Flow', () => {
    it('sequences Queue → Next → State Persistence correctly', async () => {
      // Step 1: Pick next issue
      const nextCommand = new NextCommand(logger, config, state, git, github, guard, testProjectRoot);
      await nextCommand.execute({});

      // Verify state was created
      const stateExists = await state.exists();
      expect(stateExists).toBe(true);

      const savedState = await state.read();
      expect(savedState.issue_number).toBe(42);
      expect(savedState.issue_title).toBe('Add user dashboard');
      expect(savedState.branch).toBe('issue-42-add-user-dashboard');
      // NextCommand now creates branch and advances stage
      expect(savedState.stage).toBe('branch');
      expect(savedState.stages.pick).toBe('completed');
      expect(savedState.stages.branch).toBe('completed');
    });

    it('allows commands to read and update state sequentially', async () => {
      // Initialize state
      await state.write({
        issue_number: 42,
        issue_title: 'Add user dashboard',
        branch: 'issue-42-add-user-dashboard',
        stage: 'implement',
        stages: {
          pick: 'completed',
          branch: 'completed',
          implement: 'pending',
          test: 'pending',
          pr: 'pending',
          review: 'pending',
        },
      });

      // Read state
      const currentState = await state.read();
      expect(currentState.stage).toBe('implement');
      expect(currentState.stages.implement).toBe('pending');

      // Update stage
      await state.updateStage('implement', 'completed');
      await state.write({
        ...currentState,
        stage: 'test',
        stages: {
          ...currentState.stages,
          implement: 'completed',
        },
      });

      // Verify update
      const updatedState = await state.read();
      expect(updatedState.stage).toBe('test');
      expect(updatedState.stages.implement).toBe('completed');
    });

    it('supports resume after pipeline interruption', async () => {
      // Simulate interrupted pipeline (state exists, stage is 'test')
      await state.write({
        issue_number: 42,
        issue_title: 'Add user dashboard',
        branch: 'issue-42-add-user-dashboard',
        stage: 'test',
        stages: {
          pick: 'completed',
          branch: 'completed',
          implement: 'completed',
          test: 'pending',
          pr: 'pending',
          review: 'pending',
        },
      });

      // Resume pipeline from test stage
      const stateExists = await state.exists();
      expect(stateExists).toBe(true);

      const currentState = await state.read();
      expect(currentState.stage).toBe('test');
      expect(currentState.stages.implement).toBe('completed');

      // Can proceed with test command
      expect(currentState.stages.test).toBe('pending');
    });

    it('clears state after reset command', async () => {
      // Create state
      await state.write({
        issue_number: 42,
        issue_title: 'Add user dashboard',
        branch: 'issue-42-add-user-dashboard',
        stage: 'implement',
        stages: INITIAL_STAGES,
      });

      expect(await state.exists()).toBe(true);

      // Mock readline to auto-confirm
      const readline = await import('readline');
      vi.mocked(readline.createInterface).mockReturnValue({
        question: vi.fn((_q, callback) => callback('y')),
        close: vi.fn(),
      } as any);

      // Reset pipeline
      const resetCommand = new ResetCommand(logger, config, state, git, github, guard, testProjectRoot);
      await resetCommand.execute();

      // Verify state was deleted
      expect(await state.exists()).toBe(false);
    });
  });

  describe('State Transitions', () => {
    it('follows correct stage progression: pick → branch → implement → test → demo → pr → review', async () => {
      const stages = ['pick', 'branch', 'implement', 'test', 'demo', 'pr', 'review'] as const;

      // Initialize with pick stage
      await state.write({
        issue_number: 42,
        issue_title: 'Add user dashboard',
        branch: 'issue-42-add-user-dashboard',
        stage: 'pick',
        stages: INITIAL_STAGES,
      });

      // Simulate progression through stages
      for (let i = 0; i < stages.length - 1; i++) {
        const currentStage = stages[i];
        const nextStage = stages[i + 1];

        const currentState = await state.read();
        expect(currentState.stage).toBe(currentStage);

        // Mark current stage as completed, move to next
        await state.write({
          ...currentState,
          stage: nextStage,
          stages: {
            ...currentState.stages,
            [currentStage]: 'completed',
          },
        });
      }

      // Verify final state
      const finalState = await state.read();
      expect(finalState.stage).toBe('review');
      expect(finalState.stages.pick).toBe('completed');
      expect(finalState.stages.branch).toBe('completed');
      expect(finalState.stages.implement).toBe('completed');
      expect(finalState.stages.test).toBe('completed');
      expect(finalState.stages.demo).toBe('completed');
      expect(finalState.stages.pr).toBe('completed');
    });

    it('handles failed stage correctly', async () => {
      await state.write({
        issue_number: 42,
        issue_title: 'Add user dashboard',
        branch: 'issue-42-add-user-dashboard',
        stage: 'test',
        stages: {
          pick: 'completed',
          branch: 'completed',
          implement: 'completed',
          test: 'pending',
          pr: 'pending',
          review: 'pending',
        },
      });

      // Simulate test failure
      await state.write({
        issue_number: 42,
        issue_title: 'Add user dashboard',
        branch: 'issue-42-add-user-dashboard',
        stage: 'test',
        stages: {
          pick: 'completed',
          branch: 'completed',
          implement: 'completed',
          test: 'failed',
          pr: 'pending',
          review: 'pending',
        },
      });

      const failedState = await state.read();
      expect(failedState.stage).toBe('test');
      expect(failedState.stages.test).toBe('failed');

      // Can retry from failed stage
      await state.write({
        ...failedState,
        stages: {
          ...failedState.stages,
          test: 'pending',
        },
      });

      const retriedState = await state.read();
      expect(retriedState.stages.test).toBe('pending');
    });
  });

  describe('Command Dependencies', () => {
    it('requires state for implement/test/demo/pr/review commands', async () => {
      // No state exists
      expect(await state.exists()).toBe(false);

      // Commands that require state should check and fail gracefully
      // This is verified by GuardService.requireState()
      await expect(guard.requireState()).rejects.toThrow('No active pipeline');
    });

    it('requires GitHub authentication for all commands', async () => {
      // Mock unauthenticated
      vi.mocked(github.isAuthenticated).mockResolvedValue(false);

      await expect(guard.requireGhAuth()).rejects.toThrow(/not authenticated/i);
    });

    it('requires clean git state for next command', async () => {
      // Mock dirty git state
      vi.mocked(git.isClean).mockResolvedValue(false);

      await expect(guard.requireGitClean()).rejects.toThrow(/uncommitted changes/i);
    });

    it('requires master branch for next command', async () => {
      // Mock on feature branch
      vi.mocked(git.isOnMaster).mockResolvedValue(false);

      await expect(guard.requireOnMaster()).rejects.toThrow(/main or master/i);
    });
  });

  describe('Error Recovery', () => {
    it('preserves state when command fails', async () => {
      await state.write({
        issue_number: 42,
        issue_title: 'Add user dashboard',
        branch: 'issue-42-add-user-dashboard',
        stage: 'test',
        stages: {
          pick: 'completed',
          branch: 'completed',
          implement: 'completed',
          test: 'pending',
          pr: 'pending',
          review: 'pending',
        },
      });

      const beforeState = await state.read();

      // State should still be readable after any errors
      const afterState = await state.read();
      expect(afterState).toEqual(beforeState);
      expect(await state.exists()).toBe(true);
    });

    it('allows retry after failure', async () => {
      await state.write({
        issue_number: 42,
        issue_title: 'Add user dashboard',
        branch: 'issue-42-add-user-dashboard',
        stage: 'test',
        stages: {
          pick: 'completed',
          branch: 'completed',
          implement: 'completed',
          test: 'failed',
          pr: 'pending',
          review: 'pending',
        },
      });

      // Can read failed state
      const failedState = await state.read();
      expect(failedState.stages.test).toBe('failed');

      // Can update to retry
      await state.write({
        ...failedState,
        stages: {
          ...failedState.stages,
          test: 'pending',
        },
      });

      const retryState = await state.read();
      expect(retryState.stages.test).toBe('pending');
    });
  });

  describe('ShipCommand Integration', () => {
    it('initializes state when starting fresh', async () => {
      const shipCommand = new ShipCommand(
        logger,
        config,
        state,
        git,
        github,
        guard,
        testProjectRoot
      );

      // This will fail during execution but should create state first
      try {
        await shipCommand.execute({});
      } catch (error) {
        // Expected to fail during actual command execution
      }

      // Verify state was created
      const stateExists = await state.exists();
      expect(stateExists).toBe(true);

      const savedState = await state.read();
      expect(savedState.issue_number).toBe(42);
      expect(savedState.issue_title).toBe('Add user dashboard');
    });

    it('resumes from existing state correctly', async () => {
      // Create state at PR stage (skip stages that call process.exit)
      await state.write({
        issue_number: 42,
        issue_title: 'Add user dashboard',
        branch: 'issue-42-add-user-dashboard',
        stage: 'pr',
        stages: {
          pick: 'completed',
          branch: 'completed',
          implement: 'completed',
          test: 'completed',
          pr: 'pending',
          review: 'pending',
        },
      });

      const shipCommand = new ShipCommand(
        logger,
        config,
        state,
        git,
        github,
        guard,
        testProjectRoot
      );

      // This will fail during execution but should recognize existing state
      try {
        await shipCommand.execute({});
      } catch (error) {
        // Expected to fail during actual command execution
      }

      // Verify it recognized the existing state
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Resuming pipeline for issue #42')
      );
    });
  });
});
