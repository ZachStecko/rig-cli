import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ResetCommand } from '../../src/commands/reset.command.js';
import { Logger } from '../../src/services/logger.service.js';
import { ConfigManager } from '../../src/services/config-manager.service.js';
import { StateManager } from '../../src/services/state-manager.service.js';
import { GitService } from '../../src/services/git.service.js';
import { GitHubService } from '../../src/services/github.service.js';
import { GuardService } from '../../src/services/guard.service.js';

// Mock readline module
const mockRl = {
  question: vi.fn(),
  close: vi.fn(),
};

vi.mock('readline', () => ({
  createInterface: vi.fn(() => mockRl),
}));

import * as readline from 'readline';

describe('ResetCommand', () => {
  let command: ResetCommand;
  let mockLogger: Logger;
  let mockConfig: ConfigManager;
  let mockState: StateManager;
  let mockGit: GitService;
  let mockGitHub: GitHubService;
  let mockGuard: GuardService;
  let consoleLogSpy: any;
  let exitSpy: any;

  beforeEach(() => {
    mockLogger = {
      header: vi.fn(),
      dim: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as any;

    mockConfig = {
      load: vi.fn(),
      get: vi.fn(),
    } as any;

    mockState = {
      exists: vi.fn(),
      read: vi.fn(),
      write: vi.fn(),
      delete: vi.fn(),
    } as any;

    mockGit = {
      currentBranch: vi.fn(),
      checkoutMaster: vi.fn(),
      isClean: vi.fn(),
    } as any;

    mockGitHub = {
      listIssues: vi.fn(),
    } as any;

    mockGuard = {
      requireGhAuth: vi.fn(),
    } as any;

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

    // Reset readline mocks
    vi.clearAllMocks();

    command = new ResetCommand(
      mockLogger,
      mockConfig,
      mockState,
      mockGit,
      mockGitHub,
      mockGuard,
      '/test/project'
    );
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    exitSpy.mockRestore();
  });

  describe('execute', () => {
    it('warns and exits early when no state exists', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(false);

      await command.execute();

      expect(mockLogger.warn).toHaveBeenCalledWith("No active pipeline to reset. Run 'rig next' to start.");
      expect(mockState.read).not.toHaveBeenCalled();
    });

    it('displays header when state exists', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user authentication',
        branch: 'issue-42-add-user-authentication',
        stage: 'implement' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'in_progress' as const,
          test: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });

      // Mock readline to cancel
      mockRl.question.mockImplementation((question: string, callback: (answer: string) => void) => {
        callback('n');
      });

      await command.execute();

      expect(mockLogger.header).toHaveBeenCalledWith('Reset Pipeline');
    });

    it('displays warning about what will be reset', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user authentication',
        branch: 'issue-42-add-user-authentication',
        stage: 'implement' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'in_progress' as const,
          test: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });

      // Mock readline to cancel
      mockRl.question.mockImplementation((question: string, callback: (answer: string) => void) => {
        callback('n');
      });

      await command.execute();

      expect(mockLogger.warn).toHaveBeenCalledWith('This will abort the current pipeline and delete all state.');
    });

    it('displays issue details before confirmation', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user authentication',
        branch: 'issue-42-add-user-authentication',
        stage: 'implement' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'in_progress' as const,
          test: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });

      // Mock readline to cancel
      mockRl.question.mockImplementation((question: string, callback: (answer: string) => void) => {
        callback('n');
      });

      await command.execute();

      expect(mockLogger.info).toHaveBeenCalledWith('Issue: #42 - Add user authentication');
      expect(mockLogger.info).toHaveBeenCalledWith('Current stage: implement');
      expect(mockLogger.info).toHaveBeenCalledWith('Branch: issue-42-add-user-authentication');
    });

    it('prompts for confirmation', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user authentication',
        branch: 'issue-42-add-user-authentication',
        stage: 'implement' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'in_progress' as const,
          test: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });

      // Mock readline to cancel
      mockRl.question.mockImplementation((question: string, callback: (answer: string) => void) => {
        callback('n');
      });

      await command.execute();

      expect(readline.createInterface).toHaveBeenCalled();
      expect(mockRl.question).toHaveBeenCalledWith(
        'Are you sure you want to reset? (y/N): ',
        expect.any(Function)
      );
      expect(mockRl.close).toHaveBeenCalled();
    });

    it('cancels reset when user answers no', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user authentication',
        branch: 'issue-42-add-user-authentication',
        stage: 'implement' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'in_progress' as const,
          test: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });

      // Mock readline to cancel
      mockRl.question.mockImplementation((question: string, callback: (answer: string) => void) => {
        callback('n');
      });

      await command.execute();

      expect(mockLogger.info).toHaveBeenCalledWith('Reset cancelled.');
      expect(mockGit.checkoutMaster).not.toHaveBeenCalled();
      expect(mockState.delete).not.toHaveBeenCalled();
    });

    it('cancels reset when user answers empty string', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user authentication',
        branch: 'issue-42-add-user-authentication',
        stage: 'implement' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'in_progress' as const,
          test: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });

      // Mock readline to cancel (empty string = no)
      mockRl.question.mockImplementation((question: string, callback: (answer: string) => void) => {
        callback('');
      });

      await command.execute();

      expect(mockLogger.info).toHaveBeenCalledWith('Reset cancelled.');
      expect(mockGit.checkoutMaster).not.toHaveBeenCalled();
      expect(mockState.delete).not.toHaveBeenCalled();
    });

    it('proceeds with reset when user answers y', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user authentication',
        branch: 'issue-42-add-user-authentication',
        stage: 'implement' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'in_progress' as const,
          test: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });

      // Mock readline to confirm
      mockRl.question.mockImplementation((question: string, callback: (answer: string) => void) => {
        callback('y');
      });

      vi.mocked(mockGit.checkoutMaster).mockResolvedValue();
      vi.mocked(mockGit.currentBranch).mockResolvedValue('main');

      await command.execute();

      expect(mockGit.checkoutMaster).toHaveBeenCalled();
      expect(mockState.delete).toHaveBeenCalled();
      expect(mockLogger.success).toHaveBeenCalledWith('Checked out main');
      expect(mockLogger.success).toHaveBeenCalledWith('Pipeline reset complete.');
    });

    it('proceeds with reset when user answers yes', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user authentication',
        branch: 'issue-42-add-user-authentication',
        stage: 'implement' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'in_progress' as const,
          test: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });

      // Mock readline to confirm
      mockRl.question.mockImplementation((question: string, callback: (answer: string) => void) => {
        callback('yes');
      });

      vi.mocked(mockGit.checkoutMaster).mockResolvedValue();
      vi.mocked(mockGit.currentBranch).mockResolvedValue('master');

      await command.execute();

      expect(mockGit.checkoutMaster).toHaveBeenCalled();
      expect(mockState.delete).toHaveBeenCalled();
      expect(mockLogger.success).toHaveBeenCalledWith('Checked out master');
    });

    it('handles uppercase confirmation (Y)', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user authentication',
        branch: 'issue-42-add-user-authentication',
        stage: 'implement' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'in_progress' as const,
          test: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });

      // Mock readline to confirm
      mockRl.question.mockImplementation((question: string, callback: (answer: string) => void) => {
        callback('Y');
      });

      vi.mocked(mockGit.checkoutMaster).mockResolvedValue();
      vi.mocked(mockGit.currentBranch).mockResolvedValue('main');

      await command.execute();

      expect(mockGit.checkoutMaster).toHaveBeenCalled();
      expect(mockState.delete).toHaveBeenCalled();
    });

    it('handles uppercase confirmation (YES)', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user authentication',
        branch: 'issue-42-add-user-authentication',
        stage: 'implement' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'in_progress' as const,
          test: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });

      // Mock readline to confirm
      mockRl.question.mockImplementation((question: string, callback: (answer: string) => void) => {
        callback('YES');
      });

      vi.mocked(mockGit.checkoutMaster).mockResolvedValue();
      vi.mocked(mockGit.currentBranch).mockResolvedValue('main');

      await command.execute();

      expect(mockGit.checkoutMaster).toHaveBeenCalled();
      expect(mockState.delete).toHaveBeenCalled();
    });

    it('handles whitespace in confirmation', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user authentication',
        branch: 'issue-42-add-user-authentication',
        stage: 'implement' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'in_progress' as const,
          test: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });

      // Mock readline to confirm with spaces
      vi.spyOn(readline, 'createInterface').mockReturnValue(mockRl as any);
      mockRl.question.mockImplementation((question: string, callback: (answer: string) => void) => {
        callback('  yes  ');
      });

      vi.mocked(mockGit.checkoutMaster).mockResolvedValue();
      vi.mocked(mockGit.currentBranch).mockResolvedValue('main');

      await command.execute();

      expect(mockGit.checkoutMaster).toHaveBeenCalled();
      expect(mockState.delete).toHaveBeenCalled();
    });

    it('displays success message after reset', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user authentication',
        branch: 'issue-42-add-user-authentication',
        stage: 'implement' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'in_progress' as const,
          test: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });

      // Mock readline to confirm
      mockRl.question.mockImplementation((question: string, callback: (answer: string) => void) => {
        callback('y');
      });

      vi.mocked(mockGit.checkoutMaster).mockResolvedValue();
      vi.mocked(mockGit.currentBranch).mockResolvedValue('main');

      await command.execute();

      expect(mockLogger.success).toHaveBeenCalledWith('Pipeline reset complete.');
      expect(mockLogger.dim).toHaveBeenCalledWith("State cleared. Run 'rig next' to start a new pipeline.");
    });

    it('handles git checkout failure', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user authentication',
        branch: 'issue-42-add-user-authentication',
        stage: 'implement' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'in_progress' as const,
          test: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });

      // Mock readline to confirm
      mockRl.question.mockImplementation((question: string, callback: (answer: string) => void) => {
        callback('y');
      });

      vi.mocked(mockGit.checkoutMaster).mockRejectedValue(new Error('Uncommitted changes'));

      await command.execute();

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to checkout default branch: Uncommitted changes');
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(mockState.delete).not.toHaveBeenCalled();
    });

    it('deletes state only after successful checkout', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user authentication',
        branch: 'issue-42-add-user-authentication',
        stage: 'implement' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'in_progress' as const,
          test: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });

      // Mock readline to confirm
      mockRl.question.mockImplementation((question: string, callback: (answer: string) => void) => {
        callback('y');
      });

      vi.mocked(mockGit.checkoutMaster).mockResolvedValue();
      vi.mocked(mockGit.currentBranch).mockResolvedValue('main');

      await command.execute();

      // Verify checkout happens before delete
      const checkoutCall = vi.mocked(mockGit.checkoutMaster).mock.invocationCallOrder[0];
      const deleteCall = vi.mocked(mockState.delete).mock.invocationCallOrder[0];

      expect(checkoutCall).toBeLessThan(deleteCall);
    });

    it('shows uncommitted changes warning when working tree is dirty', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user authentication',
        branch: 'issue-42-add-user-authentication',
        stage: 'implement' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'in_progress' as const,
          test: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });

      // Mock working tree as dirty
      vi.mocked(mockGit.isClean).mockResolvedValue(false);

      // Mock readline to cancel
      mockRl.question.mockImplementation((question: string, callback: (answer: string) => void) => {
        callback('n');
      });

      await command.execute();

      expect(mockGit.isClean).toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith('Uncommitted changes detected. These will be lost if not stashed.');
    });

    it('does not show uncommitted changes warning when working tree is clean', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user authentication',
        branch: 'issue-42-add-user-authentication',
        stage: 'implement' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'in_progress' as const,
          test: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });

      // Mock working tree as clean
      vi.mocked(mockGit.isClean).mockResolvedValue(true);

      // Mock readline to cancel
      mockRl.question.mockImplementation((question: string, callback: (answer: string) => void) => {
        callback('n');
      });

      await command.execute();

      expect(mockGit.isClean).toHaveBeenCalled();

      // Verify warning was NOT shown
      const warnCalls = vi.mocked(mockLogger.warn).mock.calls;
      const uncommittedWarning = warnCalls.find(call =>
        call[0].includes('Uncommitted changes detected')
      );
      expect(uncommittedWarning).toBeUndefined();
    });

    it('displays branch deletion reminder after successful reset', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user authentication',
        branch: 'issue-42-add-user-authentication',
        stage: 'implement' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'in_progress' as const,
          test: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });

      vi.mocked(mockGit.isClean).mockResolvedValue(true);

      // Mock readline to confirm
      mockRl.question.mockImplementation((question: string, callback: (answer: string) => void) => {
        callback('y');
      });

      vi.mocked(mockGit.checkoutMaster).mockResolvedValue();
      vi.mocked(mockGit.currentBranch).mockResolvedValue('main');

      await command.execute();

      expect(mockLogger.dim).toHaveBeenCalledWith(
        "Branch 'issue-42-add-user-authentication' still exists locally. Delete with: git branch -D issue-42-add-user-authentication"
      );
    });

    it('shows hint message when git checkout fails', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user authentication',
        branch: 'issue-42-add-user-authentication',
        stage: 'implement' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'in_progress' as const,
          test: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });

      vi.mocked(mockGit.isClean).mockResolvedValue(false);

      // Mock readline to confirm
      mockRl.question.mockImplementation((question: string, callback: (answer: string) => void) => {
        callback('y');
      });

      vi.mocked(mockGit.checkoutMaster).mockRejectedValue(new Error('Uncommitted changes'));

      await command.execute();

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to checkout default branch: Uncommitted changes');
      expect(mockLogger.dim).toHaveBeenCalledWith('Hint: Stash or commit changes first with: git stash');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});
