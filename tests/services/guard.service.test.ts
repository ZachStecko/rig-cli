import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GuardService } from '../../src/services/guard.service.js';
import { GitService } from '../../src/services/git.service.js';
import { GitHubService } from '../../src/services/github.service.js';
import { StateManager } from '../../src/services/state-manager.service.js';
import { GuardError } from '../../src/types/error.types.js';
import * as shell from '../../src/utils/shell.js';

// Mock the shell module
vi.mock('../../src/utils/shell.js', () => ({
  exec: vi.fn(),
}));

describe('GuardService', () => {
  let guardService: GuardService;
  let mockGit: GitService;
  let mockGithub: GitHubService;
  let mockStateManager: StateManager;
  const mockExec = vi.mocked(shell.exec);

  beforeEach(() => {
    // Create mock instances
    mockGit = {
      isClean: vi.fn(),
      isOnMaster: vi.fn(),
      isOnFeatureBranch: vi.fn(),
      currentBranch: vi.fn(),
    } as any;

    mockGithub = {
      isInstalled: vi.fn(),
      isAuthenticated: vi.fn(),
    } as any;

    mockStateManager = {
      exists: vi.fn(),
    } as any;

    guardService = new GuardService(mockGit, mockGithub, mockStateManager);
    mockExec.mockClear();
  });

  describe('requireGitClean', () => {
    it('passes when working tree is clean', async () => {
      vi.mocked(mockGit.isClean).mockResolvedValue(true);

      await expect(guardService.requireGitClean()).resolves.not.toThrow();
    });

    it('throws GuardError when working tree has uncommitted changes', async () => {
      vi.mocked(mockGit.isClean).mockResolvedValue(false);

      await expect(guardService.requireGitClean()).rejects.toThrow(GuardError);
      await expect(guardService.requireGitClean()).rejects.toThrow('uncommitted changes');
    });
  });

  describe('requireOnMaster', () => {
    it('passes when on master branch', async () => {
      vi.mocked(mockGit.isOnMaster).mockResolvedValue(true);

      await expect(guardService.requireOnMaster()).resolves.not.toThrow();
    });

    it('passes when on main branch', async () => {
      vi.mocked(mockGit.isOnMaster).mockResolvedValue(true);

      await expect(guardService.requireOnMaster()).resolves.not.toThrow();
    });

    it('throws GuardError when on feature branch', async () => {
      vi.mocked(mockGit.isOnMaster).mockResolvedValue(false);
      vi.mocked(mockGit.currentBranch).mockResolvedValue('issue-123-fix-bug');

      await expect(guardService.requireOnMaster()).rejects.toThrow(GuardError);
      await expect(guardService.requireOnMaster()).rejects.toThrow('Must be on main or master');
      await expect(guardService.requireOnMaster()).rejects.toThrow('issue-123-fix-bug');
    });
  });

  describe('requireOnFeatureBranch', () => {
    it('passes when on feature branch', async () => {
      vi.mocked(mockGit.isOnFeatureBranch).mockResolvedValue(true);

      await expect(guardService.requireOnFeatureBranch()).resolves.not.toThrow();
    });

    it('throws GuardError when on main branch', async () => {
      vi.mocked(mockGit.isOnFeatureBranch).mockResolvedValue(false);
      vi.mocked(mockGit.currentBranch).mockResolvedValue('main');

      await expect(guardService.requireOnFeatureBranch()).rejects.toThrow(GuardError);
      await expect(guardService.requireOnFeatureBranch()).rejects.toThrow('Must be on a feature branch');
      await expect(guardService.requireOnFeatureBranch()).rejects.toThrow('main');
    });

    it('throws GuardError when on master branch', async () => {
      vi.mocked(mockGit.isOnFeatureBranch).mockResolvedValue(false);
      vi.mocked(mockGit.currentBranch).mockResolvedValue('master');

      await expect(guardService.requireOnFeatureBranch()).rejects.toThrow(GuardError);
      await expect(guardService.requireOnFeatureBranch()).rejects.toThrow('master');
    });
  });

  describe('requireGhAuth', () => {
    it('passes when gh is installed and authenticated', async () => {
      vi.mocked(mockGithub.isInstalled).mockResolvedValue(true);
      vi.mocked(mockGithub.isAuthenticated).mockResolvedValue(true);

      await expect(guardService.requireGhAuth()).resolves.not.toThrow();
    });

    it('throws GuardError when gh is not installed', async () => {
      vi.mocked(mockGithub.isInstalled).mockResolvedValue(false);

      await expect(guardService.requireGhAuth()).rejects.toThrow(GuardError);
      await expect(guardService.requireGhAuth()).rejects.toThrow('not installed');
      await expect(guardService.requireGhAuth()).rejects.toThrow('https://cli.github.com');
    });

    it('throws GuardError when gh is installed but not authenticated', async () => {
      vi.mocked(mockGithub.isInstalled).mockResolvedValue(true);
      vi.mocked(mockGithub.isAuthenticated).mockResolvedValue(false);

      await expect(guardService.requireGhAuth()).rejects.toThrow(GuardError);
      await expect(guardService.requireGhAuth()).rejects.toThrow('not authenticated');
      await expect(guardService.requireGhAuth()).rejects.toThrow('gh auth login');
    });

    it('does not check authentication if gh is not installed', async () => {
      vi.mocked(mockGithub.isInstalled).mockResolvedValue(false);

      await expect(guardService.requireGhAuth()).rejects.toThrow();
      expect(mockGithub.isAuthenticated).not.toHaveBeenCalled();
    });
  });

  describe('requireClaude', () => {
    it('passes when claude CLI is installed', async () => {
      mockExec.mockResolvedValue({
        stdout: 'claude version 1.0.0\n',
        stderr: '',
        exitCode: 0,
      });

      await expect(guardService.requireClaude()).resolves.not.toThrow();
      expect(mockExec).toHaveBeenCalledWith('claude --version');
    });

    it('throws GuardError when claude CLI is not installed', async () => {
      mockExec.mockResolvedValue({
        stdout: '',
        stderr: 'command not found: claude',
        exitCode: 127,
      });

      await expect(guardService.requireClaude()).rejects.toThrow(GuardError);
      await expect(guardService.requireClaude()).rejects.toThrow('not installed');
      await expect(guardService.requireClaude()).rejects.toThrow('claude-cli');
    });

    it('throws GuardError when claude command fails', async () => {
      mockExec.mockResolvedValue({
        stdout: '',
        stderr: 'error',
        exitCode: 1,
      });

      await expect(guardService.requireClaude()).rejects.toThrow(GuardError);
    });
  });

  describe('requireState', () => {
    it('passes when state file exists', async () => {
      vi.mocked(mockStateManager.exists).mockResolvedValue(true);

      await expect(guardService.requireState()).resolves.not.toThrow();
    });

    it('throws GuardError when state file does not exist', async () => {
      vi.mocked(mockStateManager.exists).mockResolvedValue(false);

      await expect(guardService.requireState()).rejects.toThrow(GuardError);
      await expect(guardService.requireState()).rejects.toThrow('No active pipeline state');
      await expect(guardService.requireState()).rejects.toThrow('.rig-state.json');
    });
  });

  describe('checkDocker', () => {
    it('returns true when docker is installed', async () => {
      mockExec.mockResolvedValue({
        stdout: 'Docker version 24.0.0\n',
        stderr: '',
        exitCode: 0,
      });

      const result = await guardService.checkDocker();

      expect(result).toBe(true);
      expect(mockExec).toHaveBeenCalledWith('docker --version');
    });

    it('returns false when docker is not installed', async () => {
      mockExec.mockResolvedValue({
        stdout: '',
        stderr: 'command not found: docker',
        exitCode: 127,
      });

      const result = await guardService.checkDocker();

      expect(result).toBe(false);
    });

    it('returns false when docker command fails', async () => {
      mockExec.mockResolvedValue({
        stdout: '',
        stderr: 'error',
        exitCode: 1,
      });

      const result = await guardService.checkDocker();

      expect(result).toBe(false);
    });

    it('does not throw errors (unlike require* methods)', async () => {
      mockExec.mockResolvedValue({
        stdout: '',
        stderr: 'error',
        exitCode: 1,
      });

      // Should not throw, just return false
      await expect(guardService.checkDocker()).resolves.toBe(false);
    });
  });

  describe('GuardError behavior', () => {
    it('throws GuardError instances that can be caught specifically', async () => {
      vi.mocked(mockGit.isClean).mockResolvedValue(false);

      try {
        await guardService.requireGitClean();
        expect.fail('Should have thrown GuardError');
      } catch (error) {
        expect(error).toBeInstanceOf(GuardError);
        expect(error).toBeInstanceOf(Error);
        expect((error as GuardError).name).toBe('GuardError');
      }
    });

    it('allows callers to distinguish GuardError from other errors', async () => {
      vi.mocked(mockStateManager.exists).mockResolvedValue(false);

      let caughtError: any;
      try {
        await guardService.requireState();
      } catch (error) {
        caughtError = error;
      }

      expect(caughtError).toBeInstanceOf(GuardError);
      expect(caughtError.name).toBe('GuardError');
      expect(caughtError.message).toContain('No active pipeline state');
    });
  });
});
