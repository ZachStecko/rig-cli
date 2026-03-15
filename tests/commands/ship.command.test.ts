import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ShipCommand } from '../../src/commands/ship.command.js';
import { Logger } from '../../src/services/logger.service.js';
import { ConfigManager } from '../../src/services/config-manager.service.js';
import { StateManager } from '../../src/services/state-manager.service.js';
import { GitService } from '../../src/services/git.service.js';
import { GitHubService } from '../../src/services/github.service.js';
import { GuardService } from '../../src/services/guard.service.js';

// Mock all sub-commands
vi.mock('../../src/commands/next.command.js', () => ({
  NextCommand: vi.fn().mockImplementation(() => ({
    execute: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../src/commands/implement.command.js', () => ({
  ImplementCommand: vi.fn().mockImplementation(() => ({
    execute: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../src/commands/test.command.js', () => ({
  TestCommand: vi.fn().mockImplementation(() => ({
    execute: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../src/commands/pr.command.js', () => ({
  PrCommand: vi.fn().mockImplementation(() => ({
    execute: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../src/commands/review.command.js', () => ({
  ReviewCommand: vi.fn().mockImplementation(() => ({
    execute: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock ClaudeCodeAgent (used by ship for fix agent)
vi.mock('../../src/services/agents/claude-code.agent.js', () => ({
  ClaudeCodeAgent: vi.fn().mockImplementation(() => ({
    isAvailable: vi.fn().mockResolvedValue(true),
    createSession: vi.fn().mockResolvedValue({
      events: (async function* () {
        yield { type: 'text', content: 'Fix applied' };
      })(),
      cancel: vi.fn(),
    }),
  })),
}));

describe('ShipCommand', () => {
  let command: ShipCommand;
  let mockLogger: Logger;
  let mockConfig: ConfigManager;
  let mockState: StateManager;
  let mockGit: GitService;
  let mockGitHub: GitHubService;
  let mockGuard: GuardService;
  let exitSpy: any;

  // Default state returned after "nextCommand picks an issue"
  const defaultFreshState = {
    issue_number: 42,
    issue_title: 'Test Issue',
    branch: 'issue-42-test-issue',
    stage: 'branch',
    stages: {
      pick: 'completed',
      branch: 'completed',
      implement: 'pending',
      test: 'pending',
      pr: 'pending',
      review: 'pending',
    },
  };

  beforeEach(async () => {
    mockLogger = {
      header: vi.fn(),
      dim: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      step: vi.fn(),
    } as any;

    mockConfig = {
      load: vi.fn(),
      get: vi.fn().mockReturnValue({ agent: { max_turns: 20 } }),
    } as any;

    mockState = {
      exists: vi.fn(),
      read: vi.fn(),
      write: vi.fn(),
    } as any;

    mockGit = {
      currentBranch: vi.fn(),
    } as any;

    mockGitHub = {
      viewIssue: vi.fn().mockResolvedValue({
        number: 42,
        title: 'Test Issue',
        labels: [{ name: 'fullstack' }],
        state: 'OPEN',
      }),
    } as any;

    mockGuard = {
      requireGhAuth: vi.fn(),
    } as any;

    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

    // Reset all mocks
    vi.clearAllMocks();

    command = new ShipCommand(
      mockLogger,
      mockConfig,
      mockState,
      mockGit,
      mockGitHub,
      mockGuard,
      '/test/project'
    );
  });

  describe('execute', () => {
    it('checks GitHub authentication before proceeding', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(false);
      vi.mocked(mockState.read).mockResolvedValue(defaultFreshState);

      await command.execute();

      expect(mockGuard.requireGhAuth).toHaveBeenCalled();
    });

    it('displays header', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(false);
      vi.mocked(mockState.read).mockResolvedValue(defaultFreshState);

      await command.execute();

      expect(mockLogger.header).toHaveBeenCalledWith('Ship: Full Issue-to-PR Pipeline');
    });

    it('starts fresh pipeline when no state exists', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(false);
      vi.mocked(mockState.read).mockResolvedValue(defaultFreshState);

      await command.execute();

      // Should call NextCommand to pick issue
      expect((command as any).nextCommand.execute).toHaveBeenCalled();

      // Should run all pipeline stages (demo removed)
      expect((command as any).implementCommand.execute).toHaveBeenCalled();
      expect((command as any).testCommand.execute).toHaveBeenCalled();
      expect((command as any).prCommand.execute).toHaveBeenCalled();
      expect((command as any).reviewCommand.execute).toHaveBeenCalled();
    });

    it('passes phase and component filters to NextCommand', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(false);
      vi.mocked(mockState.read).mockResolvedValue(defaultFreshState);

      await command.execute({ phase: 'Phase 1: MVP', component: 'backend' });

      expect((command as any).nextCommand.execute).toHaveBeenCalledWith({
        phase: 'Phase 1: MVP',
        component: 'backend',
      });
    });

    it('starts with specific issue when --issue provided', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(false);
      vi.mocked(mockState.read).mockResolvedValue(defaultFreshState);

      await command.execute({ issue: '99' });

      expect(mockLogger.info).toHaveBeenCalledWith('Starting pipeline with issue #99...');
      expect((command as any).nextCommand.execute).toHaveBeenCalled();
    });

    it('errors on invalid issue number', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(false);

      await command.execute({ issue: 'abc' });

      expect(mockLogger.error).toHaveBeenCalledWith('Invalid issue number: abc');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('resumes existing pipeline from current stage', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
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

      await command.execute();

      expect(mockLogger.info).toHaveBeenCalledWith('Resuming pipeline for issue #42: Add user dashboard');
      expect(mockLogger.dim).toHaveBeenCalledWith('Current stage: test');

      // Should NOT call NextCommand when resuming
      expect((command as any).nextCommand.execute).not.toHaveBeenCalled();

      // Should skip to test stage and run remaining stages
      expect((command as any).implementCommand.execute).not.toHaveBeenCalled(); // Already completed
      expect((command as any).testCommand.execute).toHaveBeenCalled();
      expect((command as any).prCommand.execute).toHaveBeenCalled();
      expect((command as any).reviewCommand.execute).toHaveBeenCalled();
    });

    it('resumes from implement stage', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
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

      await command.execute();

      expect((command as any).implementCommand.execute).toHaveBeenCalled();
      expect((command as any).testCommand.execute).toHaveBeenCalled();
      expect((command as any).prCommand.execute).toHaveBeenCalled();
      expect((command as any).reviewCommand.execute).toHaveBeenCalled();
    });

    it('resumes from pr stage', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
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

      await command.execute();

      expect((command as any).implementCommand.execute).not.toHaveBeenCalled();
      expect((command as any).testCommand.execute).not.toHaveBeenCalled();
      expect((command as any).prCommand.execute).toHaveBeenCalled();
      expect((command as any).reviewCommand.execute).toHaveBeenCalled();
    });

    it('resumes from review stage', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user dashboard',
        branch: 'issue-42-add-user-dashboard',
        stage: 'review',
        stages: {
          pick: 'completed',
          branch: 'completed',
          implement: 'completed',
          test: 'completed',
          pr: 'completed',
          review: 'pending',
        },
      });

      await command.execute();

      expect((command as any).implementCommand.execute).not.toHaveBeenCalled();
      expect((command as any).testCommand.execute).not.toHaveBeenCalled();
      expect((command as any).prCommand.execute).not.toHaveBeenCalled();
      expect((command as any).reviewCommand.execute).toHaveBeenCalled();
    });

    it('detects stale state when issue no longer exists', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
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

      vi.mocked(mockGitHub.viewIssue).mockRejectedValue(new Error('Issue not found'));

      await command.execute();

      expect(mockLogger.error).toHaveBeenCalledWith('Issue #42 is no longer OPEN. Pipeline aborted.');
      expect(mockLogger.info).toHaveBeenCalledWith(`Run 'rig reset' to clear state and start fresh.`);
      expect(exitSpy).toHaveBeenCalledWith(1);

      // Should not run any pipeline stages
      expect((command as any).implementCommand.execute).not.toHaveBeenCalled();
    });

    it('detects stale state when issue is closed', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
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

      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 42,
        title: 'Add user dashboard',
        labels: [{ name: 'fullstack' }],
        state: 'CLOSED',
      });

      await command.execute();

      expect(mockLogger.error).toHaveBeenCalledWith('Issue #42 is no longer OPEN. Pipeline aborted.');
      expect(mockLogger.info).toHaveBeenCalledWith(`Run 'rig reset' to clear state and start fresh.`);
      expect(exitSpy).toHaveBeenCalledWith(1);

      // Should not run any pipeline stages
      expect((command as any).implementCommand.execute).not.toHaveBeenCalled();
    });

    it('retries tests up to 3 times on failure', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(false);
      vi.mocked(mockState.read).mockResolvedValue(defaultFreshState);

      // Mock test command to fail twice, then succeed
      let testAttempts = 0;
      vi.mocked((command as any).testCommand.execute).mockImplementation(() => {
        testAttempts++;
        if (testAttempts < 3) {
          throw new Error('Tests failed');
        }
        return Promise.resolve();
      });

      await command.execute();

      // Should have retried tests 3 times
      expect((command as any).testCommand.execute).toHaveBeenCalledTimes(3);
      expect(mockLogger.warn).toHaveBeenCalledWith('Tests failed on attempt 1/3.');
      expect(mockLogger.warn).toHaveBeenCalledWith('Tests failed on attempt 2/3.');
    });

    it('fails pipeline after max test retries', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(false);
      vi.mocked(mockState.read).mockResolvedValue(defaultFreshState);

      // Mock test command to always fail
      vi.mocked((command as any).testCommand.execute).mockRejectedValue(new Error('Tests failed'));

      await expect(command.execute()).rejects.toThrow('Tests failed');

      expect((command as any).testCommand.execute).toHaveBeenCalledTimes(3);
      expect(mockLogger.error).toHaveBeenCalledWith('Tests failed after 3 attempts. Pipeline aborted.');
      expect(mockLogger.info).toHaveBeenCalledWith(`Run 'rig test' to retry, or 'rig reset' to abandon this issue.`);
    });

    it('displays success message on completion', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(false);
      vi.mocked(mockState.read).mockResolvedValue(defaultFreshState);

      await command.execute();

      expect(mockLogger.success).toHaveBeenCalledWith('Pipeline complete!');
      expect(mockLogger.info).toHaveBeenCalledWith('Issue has been implemented, tested, and submitted for review.');
    });

    it('logs stage names during execution', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(false);
      vi.mocked(mockState.read).mockResolvedValue(defaultFreshState);

      await command.execute();

      expect(mockLogger.info).toHaveBeenCalledWith('Stage: implement');
      expect(mockLogger.info).toHaveBeenCalledWith('Stage: test');
      expect(mockLogger.info).toHaveBeenCalledWith('Stage: pr');
      expect(mockLogger.info).toHaveBeenCalledWith('Stage: review');
    });
  });
});
