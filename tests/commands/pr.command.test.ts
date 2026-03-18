import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrCommand } from '../../src/commands/pr.command.js';
import { Logger } from '../../src/services/logger.service.js';
import { ConfigManager } from '../../src/services/config-manager.service.js';
import { StateManager } from '../../src/services/state-manager.service.js';
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

// Mock PromptBuilderService
const mockPromptBuilder = {
  detectComponent: vi.fn(),
  detectComponentFromConfig: vi.fn(),
  assemblePrFixPrompt: vi.fn(),
};

vi.mock('../../src/services/prompt-builder.service.js', () => ({
  PromptBuilderService: vi.fn(() => mockPromptBuilder),
}));

// Mock TestRunnerService
vi.mock('../../src/services/test-runner.service.js', () => ({
  TestRunnerService: vi.fn(() => ({})),
}));

describe('PrCommand', () => {
  let command: PrCommand;
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
      step: vi.fn(),
    } as any;

    mockConfig = {
      load: vi.fn(),
      get: vi.fn().mockReturnValue({ agent: { max_turns: 80 }, components: {} }),
    } as any;

    mockState = {
      exists: vi.fn(),
      read: vi.fn(),
      write: vi.fn(),
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
      listPrReviewComments: vi.fn(),
      viewPr: vi.fn(),
      detectPrFromBranch: vi.fn(),
      prComment: vi.fn(),
      prCommentWithReference: vi.fn(),
    } as any;

    mockGuard = {
      requireGhAuth: vi.fn(),
    } as any;

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

    // Reset all mocks
    vi.clearAllMocks();

    command = new PrCommand(
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

      await command.execute();

      expect(mockGuard.requireGhAuth).toHaveBeenCalled();
    });

    it('exits with error when no state exists', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(false);

      await command.execute();

      expect(mockLogger.error).toHaveBeenCalledWith("No active pipeline. Run 'rig next' to start or use --issue <number>.");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('creates new PR when none exists', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user dashboard',
        branch: 'issue-42-add-user-dashboard',
        stage: 'test' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'completed' as const,
          test: 'completed' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 42,
        title: 'Add user dashboard',
        labels: [{ name: 'frontend' }],
      });
      vi.mocked(mockPromptBuilder.detectComponentFromConfig).mockReturnValue('frontend');
      vi.mocked(mockGit.currentBranch).mockResolvedValue('issue-42-add-user-dashboard');
      vi.mocked(mockPrTemplate.generatePrBody).mockResolvedValue('PR body content here');
      vi.mocked(mockGitHub.prListByHead).mockResolvedValue([]);
      vi.mocked(mockGitHub.createPr).mockResolvedValue('https://github.com/owner/repo/pull/123');

      await command.execute();

      expect(mockGit.push).toHaveBeenCalled();
      expect(mockPrTemplate.generatePrBody).toHaveBeenCalledWith(42, 'frontend');
      expect(mockGitHub.createPr).toHaveBeenCalledWith({
        title: 'Add user dashboard',
        body: 'PR body content here',
      });
      expect(mockLogger.success).toHaveBeenCalledWith('Pull request created/updated successfully');
      expect(mockLogger.info).toHaveBeenCalledWith('URL: https://github.com/owner/repo/pull/123');
    });

    it('updates existing PR when one exists', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user dashboard',
        branch: 'issue-42-add-user-dashboard',
        stage: 'test' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'completed' as const,
          test: 'completed' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 42,
        title: 'Add user dashboard',
        labels: [{ name: 'backend' }],
      });
      vi.mocked(mockPromptBuilder.detectComponentFromConfig).mockReturnValue('backend');
      vi.mocked(mockGit.currentBranch).mockResolvedValue('issue-42-add-user-dashboard');
      vi.mocked(mockPrTemplate.generatePrBody).mockResolvedValue('Updated PR body');
      vi.mocked(mockGitHub.prListByHead).mockResolvedValue([
        { number: 99, title: 'Add user dashboard' },
      ]);
      vi.mocked(mockGitHub.repoName).mockResolvedValue('owner/repo');

      await command.execute();

      expect(mockGitHub.editPr).toHaveBeenCalledWith(99, {
        title: 'Add user dashboard',
        body: 'Updated PR body',
      });
      expect(mockLogger.info).toHaveBeenCalledWith('Updating existing PR #99...');
      expect(mockLogger.info).toHaveBeenCalledWith('URL: https://github.com/owner/repo/pull/99');
    });

    it('displays header with issue info', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user dashboard',
        branch: 'issue-42-add-user-dashboard',
        stage: 'test' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'completed' as const,
          test: 'completed' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 42,
        title: 'Add user dashboard',
        labels: [{ name: 'frontend' }],
      });
      vi.mocked(mockPromptBuilder.detectComponentFromConfig).mockReturnValue('frontend');
      vi.mocked(mockGit.currentBranch).mockResolvedValue('issue-42-add-user-dashboard');
      vi.mocked(mockPrTemplate.generatePrBody).mockResolvedValue('PR body');
      vi.mocked(mockGitHub.prListByHead).mockResolvedValue([]);
      vi.mocked(mockGitHub.createPr).mockResolvedValue('https://github.com/owner/repo/pull/123');

      await command.execute();

      expect(mockLogger.header).toHaveBeenCalledWith('Creating Pull Request for Issue #42');
      expect(mockLogger.info).toHaveBeenCalledWith('Issue: Add user dashboard');
      expect(mockLogger.info).toHaveBeenCalledWith('Branch: issue-42-add-user-dashboard');
      expect(mockLogger.info).toHaveBeenCalledWith('Component: frontend');
    });

    it('updates state to in_progress before creating PR', async () => {
      const initialState = {
        issue_number: 42,
        issue_title: 'Add user dashboard',
        branch: 'issue-42-add-user-dashboard',
        stage: 'test' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'completed' as const,
          test: 'completed' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      };

      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({ ...initialState });
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 42,
        title: 'Add user dashboard',
        labels: [{ name: 'frontend' }],
      });
      vi.mocked(mockPromptBuilder.detectComponentFromConfig).mockReturnValue('frontend');
      vi.mocked(mockGit.currentBranch).mockResolvedValue('issue-42-add-user-dashboard');
      vi.mocked(mockPrTemplate.generatePrBody).mockResolvedValue('PR body');
      vi.mocked(mockGitHub.prListByHead).mockResolvedValue([]);
      vi.mocked(mockGitHub.createPr).mockResolvedValue('https://github.com/owner/repo/pull/123');

      await command.execute();

      // Check that state was written twice
      expect(mockState.write).toHaveBeenCalledTimes(2);

      // Check first write call (should mark pr as in_progress)
      const firstCall = vi.mocked(mockState.write).mock.calls[0][0];
      expect(firstCall.stage).toBe('pr');
      expect(firstCall.stages.pr).toBe('in_progress');
    });

    it('marks pr as completed on success', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user dashboard',
        branch: 'issue-42-add-user-dashboard',
        stage: 'pr' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'completed' as const,
          test: 'completed' as const,
          pr: 'in_progress' as const,
          review: 'pending' as const,
        },
      });
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 42,
        title: 'Add user dashboard',
        labels: [{ name: 'frontend' }],
      });
      vi.mocked(mockPromptBuilder.detectComponentFromConfig).mockReturnValue('frontend');
      vi.mocked(mockGit.currentBranch).mockResolvedValue('issue-42-add-user-dashboard');
      vi.mocked(mockPrTemplate.generatePrBody).mockResolvedValue('PR body');
      vi.mocked(mockGitHub.prListByHead).mockResolvedValue([]);
      vi.mocked(mockGitHub.createPr).mockResolvedValue('https://github.com/owner/repo/pull/123');

      await command.execute();

      // Check second write call (should mark pr as completed)
      expect(mockState.write).toHaveBeenNthCalledWith(2, expect.objectContaining({
        stages: expect.objectContaining({
          pr: 'completed',
        }),
      }));
    });

    it('marks pr as failed on error', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user dashboard',
        branch: 'issue-42-add-user-dashboard',
        stage: 'pr' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'completed' as const,
          test: 'completed' as const,
          pr: 'in_progress' as const,
          review: 'pending' as const,
        },
      });
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 42,
        title: 'Add user dashboard',
        labels: [{ name: 'frontend' }],
      });
      vi.mocked(mockPromptBuilder.detectComponentFromConfig).mockReturnValue('frontend');
      vi.mocked(mockGit.currentBranch).mockResolvedValue('issue-42-add-user-dashboard');
      vi.mocked(mockGit.push).mockRejectedValue(new Error('Push failed'));

      await command.execute();

      // Check second write call (should mark pr as failed)
      expect(mockState.write).toHaveBeenNthCalledWith(2, expect.objectContaining({
        stages: expect.objectContaining({
          pr: 'failed',
        }),
      }));

      expect(mockLogger.error).toHaveBeenCalledWith('PR creation failed: Push failed');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('displays progress steps during execution', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user dashboard',
        branch: 'issue-42-add-user-dashboard',
        stage: 'pr' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'completed' as const,
          test: 'completed' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 42,
        title: 'Add user dashboard',
        labels: [{ name: 'frontend' }],
      });
      vi.mocked(mockPromptBuilder.detectComponentFromConfig).mockReturnValue('frontend');
      vi.mocked(mockGit.currentBranch).mockResolvedValue('issue-42-add-user-dashboard');
      vi.mocked(mockPrTemplate.generatePrBody).mockResolvedValue('PR body');
      vi.mocked(mockGitHub.prListByHead).mockResolvedValue([]);
      vi.mocked(mockGitHub.createPr).mockResolvedValue('https://github.com/owner/repo/pull/123');

      await command.execute();

      expect(mockLogger.step).toHaveBeenCalledWith(1, 3, 'Pushing commits to remote...');
      expect(mockLogger.step).toHaveBeenCalledWith(2, 3, 'Generating PR body from template...');
      expect(mockLogger.step).toHaveBeenCalledWith(3, 3, 'Creating or updating pull request...');
    });

    it('detects component from issue labels', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user dashboard',
        branch: 'issue-42-add-user-dashboard',
        stage: 'pr' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'completed' as const,
          test: 'completed' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 42,
        title: 'Add user dashboard',
        labels: [{ name: 'backend' }, { name: 'enhancement' }],
      });
      vi.mocked(mockPromptBuilder.detectComponentFromConfig).mockReturnValue('backend');
      vi.mocked(mockGit.currentBranch).mockResolvedValue('issue-42-add-user-dashboard');
      vi.mocked(mockPrTemplate.generatePrBody).mockResolvedValue('PR body');
      vi.mocked(mockGitHub.prListByHead).mockResolvedValue([]);
      vi.mocked(mockGitHub.createPr).mockResolvedValue('https://github.com/owner/repo/pull/123');

      await command.execute();

      expect(mockPromptBuilder.detectComponentFromConfig).toHaveBeenCalledWith(['backend', 'enhancement'], expect.objectContaining({ components: {} }));
      expect(mockPrTemplate.generatePrBody).toHaveBeenCalledWith(42, 'backend');
    });

    it('handles fullstack component', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user dashboard',
        branch: 'issue-42-add-user-dashboard',
        stage: 'pr' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'completed' as const,
          test: 'completed' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 42,
        title: 'Add user dashboard',
        labels: [{ name: 'fullstack' }],
      });
      vi.mocked(mockPromptBuilder.detectComponentFromConfig).mockReturnValue('fullstack');
      vi.mocked(mockGit.currentBranch).mockResolvedValue('issue-42-add-user-dashboard');
      vi.mocked(mockPrTemplate.generatePrBody).mockResolvedValue('PR body');
      vi.mocked(mockGitHub.prListByHead).mockResolvedValue([]);
      vi.mocked(mockGitHub.createPr).mockResolvedValue('https://github.com/owner/repo/pull/123');

      await command.execute();

      expect(mockPrTemplate.generatePrBody).toHaveBeenCalledWith(42, 'fullstack');
      expect(mockLogger.info).toHaveBeenCalledWith('Component: fullstack');
    });

    it('pushes to remote before creating PR', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user dashboard',
        branch: 'issue-42-add-user-dashboard',
        stage: 'pr' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'completed' as const,
          test: 'completed' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 42,
        title: 'Add user dashboard',
        labels: [{ name: 'frontend' }],
      });
      vi.mocked(mockPromptBuilder.detectComponentFromConfig).mockReturnValue('frontend');
      vi.mocked(mockGit.currentBranch).mockResolvedValue('issue-42-add-user-dashboard');
      vi.mocked(mockPrTemplate.generatePrBody).mockResolvedValue('PR body');
      vi.mocked(mockGitHub.prListByHead).mockResolvedValue([]);
      vi.mocked(mockGitHub.createPr).mockResolvedValue('https://github.com/owner/repo/pull/123');

      await command.execute();

      // Verify push was called
      expect(mockGit.push).toHaveBeenCalled();

      // Verify push was called before createPr
      const pushOrder = vi.mocked(mockGit.push).mock.invocationCallOrder[0];
      const createPrOrder = vi.mocked(mockGitHub.createPr).mock.invocationCallOrder[0];
      expect(pushOrder).toBeLessThan(createPrOrder);
    });
  });

  describe('--comment flag review comments integration', () => {
    it('adds listPrReviewComments method to GitHub service', () => {
      expect(mockGitHub.listPrReviewComments).toBeDefined();
    });

    it('updates assemblePrFixPrompt signature to accept review comments', () => {
      expect(mockPromptBuilder.assemblePrFixPrompt).toBeDefined();
    });
  });
});
