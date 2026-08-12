import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrCommand } from '../../src/commands/pr.command.js';
import { Logger } from '../../src/services/logger.service.js';
import { ConfigManager } from '../../src/services/config-manager.service.js';
import { GitService } from '../../src/services/git.service.js';
import { GitHubService } from '../../src/services/github.service.js';
import { GuardService } from '../../src/services/guard.service.js';

// Mock PrTemplateService
const mockPrTemplate = {
  generatePrBody: vi.fn(),
};

vi.mock('../../src/services/pr-template.service.js', () => ({
  PrTemplateService: vi.fn(() => mockPrTemplate),
}));

describe('PrCommand', () => {
  let command: PrCommand;
  let mockLogger: Logger;
  let mockConfig: ConfigManager;
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
      step: vi.fn(),
    } as any;

    mockConfig = {
      load: vi.fn(),
      get: vi.fn().mockReturnValue({}),
    } as any;

    mockGit = {
      currentBranch: vi.fn(),
      push: vi.fn(),
    } as any;

    mockGitHub = {
      viewIssue: vi.fn(),
      prListByHead: vi.fn(),
      createPr: vi.fn(),
      editPr: vi.fn(),
      repoName: vi.fn(),
    } as any;

    mockGuard = {
      requireGhAuth: vi.fn(),
    } as any;

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

    vi.clearAllMocks();

    command = new PrCommand(
      mockLogger,
      mockConfig,
      mockGit,
      mockGitHub,
      mockGuard,
      '/test/project'
    );
  });

  describe('issue resolution', () => {
    it('uses the --issue flag when provided', async () => {
      vi.mocked(mockGit.currentBranch).mockResolvedValue('any-branch');
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({ title: 'Add auth', labels: [] } as any);
      vi.mocked(mockGitHub.prListByHead).mockResolvedValue([]);
      vi.mocked(mockGitHub.createPr).mockResolvedValue('https://github.com/u/r/pull/7');
      mockPrTemplate.generatePrBody.mockResolvedValue('body');

      await command.execute({ issue: '42' });

      expect(mockGitHub.viewIssue).toHaveBeenCalledWith(42);
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('rejects an invalid --issue value', async () => {
      vi.mocked(mockGit.currentBranch).mockResolvedValue('any-branch');

      await command.execute({ issue: 'abc' });

      expect(mockLogger.error).toHaveBeenCalledWith('Invalid issue number: abc');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it.each([
      ['issue-42-add-auth', 42],
      ['feat/issue-42-add-auth', 42],
      ['42-add-auth', 42],
      ['feat/42-add-auth', 42],
    ])('parses issue number from branch %s', async (branch, expected) => {
      vi.mocked(mockGit.currentBranch).mockResolvedValue(branch);
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({ title: 'Add auth', labels: [] } as any);
      vi.mocked(mockGitHub.prListByHead).mockResolvedValue([]);
      vi.mocked(mockGitHub.createPr).mockResolvedValue('https://github.com/u/r/pull/7');
      mockPrTemplate.generatePrBody.mockResolvedValue('body');

      await command.execute();

      expect(mockGitHub.viewIssue).toHaveBeenCalledWith(expected);
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('errors when no issue number can be detected from the branch', async () => {
      vi.mocked(mockGit.currentBranch).mockResolvedValue('random-branch-name');

      await command.execute();

      expect(mockLogger.error).toHaveBeenCalledWith(
        "Cannot detect an issue number from branch 'random-branch-name'."
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('does not treat trailing digits in a slug as an issue number', async () => {
      vi.mocked(mockGit.currentBranch).mockResolvedValue('upgrade-node-20');

      await command.execute();

      expect(mockLogger.error).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('PR creation', () => {
    beforeEach(() => {
      vi.mocked(mockGit.currentBranch).mockResolvedValue('issue-42-add-auth');
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({ title: 'Add auth', labels: [] } as any);
      mockPrTemplate.generatePrBody.mockResolvedValue('generated body');
    });

    it('checks GitHub authentication first', async () => {
      vi.mocked(mockGitHub.prListByHead).mockResolvedValue([]);
      vi.mocked(mockGitHub.createPr).mockResolvedValue('https://github.com/u/r/pull/7');

      await command.execute();

      expect(mockGuard.requireGhAuth).toHaveBeenCalled();
    });

    it('pushes the branch before creating the PR', async () => {
      vi.mocked(mockGitHub.prListByHead).mockResolvedValue([]);
      vi.mocked(mockGitHub.createPr).mockResolvedValue('https://github.com/u/r/pull/7');

      await command.execute();

      expect(mockGit.push).toHaveBeenCalled();
    });

    it('creates a new PR with the issue title and generated body', async () => {
      vi.mocked(mockGitHub.prListByHead).mockResolvedValue([]);
      vi.mocked(mockGitHub.createPr).mockResolvedValue('https://github.com/u/r/pull/7');

      await command.execute();

      expect(mockPrTemplate.generatePrBody).toHaveBeenCalledWith(42);
      expect(mockGitHub.createPr).toHaveBeenCalledWith({
        title: 'Add auth',
        body: 'generated body',
        base: undefined,
      });
      expect(mockLogger.success).toHaveBeenCalledWith('Pull request created/updated successfully');
    });

    it('passes the configured base branch to createPr', async () => {
      vi.mocked(mockConfig.get).mockReturnValue({ git: { base_branch: 'develop' } } as any);
      vi.mocked(mockGitHub.prListByHead).mockResolvedValue([]);
      vi.mocked(mockGitHub.createPr).mockResolvedValue('https://github.com/u/r/pull/7');

      await command.execute();

      expect(mockGitHub.createPr).toHaveBeenCalledWith(
        expect.objectContaining({ base: 'develop' })
      );
    });

    it('updates the existing PR when one exists for the branch', async () => {
      vi.mocked(mockGitHub.prListByHead).mockResolvedValue([{ number: 9 }] as any);
      vi.mocked(mockGitHub.repoName).mockResolvedValue('u/r');

      await command.execute();

      expect(mockGitHub.editPr).toHaveBeenCalledWith(9, {
        title: 'Add auth',
        body: 'generated body',
      });
      expect(mockGitHub.createPr).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith('URL: https://github.com/u/r/pull/9');
    });

    it('exits with an error message when the push fails', async () => {
      vi.mocked(mockGit.push).mockRejectedValue(new Error('remote rejected'));

      await command.execute();

      expect(mockLogger.error).toHaveBeenCalledWith('PR creation failed: remote rejected');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});
