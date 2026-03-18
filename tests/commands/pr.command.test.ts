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
};

vi.mock('../../src/services/prompt-builder.service.js', () => ({
  PromptBuilderService: vi.fn(() => mockPromptBuilder),
}));

// Mock TestRunnerService
vi.mock('../../src/services/test-runner.service.js', () => ({
  TestRunnerService: vi.fn(() => ({})),
}));

// Mock createAgent factory
const createMockAgentSession = () => ({
  events: (async function* () {
    yield { type: 'text', content: 'Generated reply text' };
  })(),
  cancel: vi.fn(),
});

const mockAgent = {
  isAvailable: vi.fn().mockResolvedValue(true),
  checkAuth: vi.fn().mockResolvedValue({ authenticated: true, method: 'api_key' }),
  createSession: vi.fn(),
};

vi.mock('../../src/services/agents/agent-factory.js', () => ({
  createAgent: vi.fn(() => mockAgent),
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
      viewPr: vi.fn(),
      detectPrFromBranch: vi.fn(),
      getPrReviewComments: vi.fn(),
      replyToPrReviewComment: vi.fn(),
    } as any;

    mockGuard = {
      requireGhAuth: vi.fn(),
    } as any;

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

    // Reset all mocks
    vi.clearAllMocks();

    // Reset agent mock to return new session for each test
    mockAgent.createSession.mockImplementation(() => Promise.resolve(createMockAgentSession()));

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

  describe('execute with --comment flag', () => {
    it('fetches review comments and generates specific replies', async () => {
      vi.mocked(mockGit.currentBranch).mockResolvedValue('issue-42-feature');
      vi.mocked(mockGitHub.detectPrFromBranch).mockResolvedValue(123);
      vi.mocked(mockGitHub.viewPr).mockResolvedValue({
        number: 123,
        title: 'Add feature',
        headRefName: 'issue-42-feature',
      });
      vi.mocked(mockGitHub.getPrReviewComments).mockResolvedValue([
        {
          id: 1,
          path: 'src/auth.ts',
          line: 42,
          start_line: null,
          body: 'Should add input validation here',
          diff_hunk: '@@ -40,3 +40,5 @@\n+function login() {\n+  return user;\n+}',
          user: { login: 'reviewer' },
        },
      ]);
      vi.mocked(mockGitHub.replyToPrReviewComment).mockResolvedValue(999);
      vi.mocked(mockGitHub.repoName).mockResolvedValue('owner/repo');

      await command.execute({ comment: true });

      expect(mockGitHub.getPrReviewComments).toHaveBeenCalledWith(123);
      expect(mockAgent.createSession).toHaveBeenCalled();
      expect(mockGitHub.replyToPrReviewComment).toHaveBeenCalledWith(123, 1, expect.stringContaining('Generated reply text'));
      expect(mockLogger.success).toHaveBeenCalledWith(expect.stringContaining('PR review replies posted successfully'));
    });

    it('warns when no review comments found', async () => {
      vi.mocked(mockGit.currentBranch).mockResolvedValue('issue-42-feature');
      vi.mocked(mockGitHub.detectPrFromBranch).mockResolvedValue(123);
      vi.mocked(mockGitHub.viewPr).mockResolvedValue({
        number: 123,
        title: 'Add feature',
        headRefName: 'issue-42-feature',
      });
      vi.mocked(mockGitHub.getPrReviewComments).mockResolvedValue([]);

      await command.execute({ comment: true });

      expect(mockLogger.warn).toHaveBeenCalledWith('No review comments found on this PR.');
      expect(mockLogger.info).toHaveBeenCalledWith('Nothing to reply to.');
      expect(mockAgent.createSession).not.toHaveBeenCalled();
    });

    it('handles multiple review comments', async () => {
      vi.mocked(mockGit.currentBranch).mockResolvedValue('issue-42-feature');
      vi.mocked(mockGitHub.detectPrFromBranch).mockResolvedValue(123);
      vi.mocked(mockGitHub.viewPr).mockResolvedValue({
        number: 123,
        title: 'Add feature',
        headRefName: 'issue-42-feature',
      });
      vi.mocked(mockGitHub.getPrReviewComments).mockResolvedValue([
        {
          id: 1,
          path: 'src/auth.ts',
          line: 42,
          start_line: null,
          body: 'Should add input validation',
          diff_hunk: '@@ -40,3 +40,5 @@\n+function login() {\n+  return user;\n+}',
          user: { login: 'reviewer' },
        },
        {
          id: 2,
          path: 'src/utils.ts',
          line: 15,
          start_line: null,
          body: 'Consider using async/await',
          diff_hunk: '@@ -13,2 +13,4 @@\n+function fetch() {\n+  return data;\n+}',
          user: { login: 'reviewer' },
        },
      ]);
      vi.mocked(mockGitHub.replyToPrReviewComment).mockResolvedValue(999);
      vi.mocked(mockGitHub.repoName).mockResolvedValue('owner/repo');

      await command.execute({ comment: true });

      expect(mockAgent.createSession).toHaveBeenCalledTimes(2);
      expect(mockGitHub.replyToPrReviewComment).toHaveBeenCalledTimes(2);
      expect(mockGitHub.replyToPrReviewComment).toHaveBeenNthCalledWith(1, 123, 1, expect.any(String));
      expect(mockGitHub.replyToPrReviewComment).toHaveBeenNthCalledWith(2, 123, 2, expect.any(String));
    });

    it('uses explicit PR number when provided', async () => {
      vi.mocked(mockGitHub.viewPr).mockResolvedValue({
        number: 456,
        title: 'Add feature',
        headRefName: 'issue-42-feature',
      });
      vi.mocked(mockGitHub.getPrReviewComments).mockResolvedValue([
        {
          id: 1,
          path: 'src/test.ts',
          line: 10,
          start_line: null,
          body: 'Add test coverage',
          diff_hunk: '@@ -8,2 +8,3 @@\n+test()',
          user: { login: 'reviewer' },
        },
      ]);
      vi.mocked(mockGitHub.replyToPrReviewComment).mockResolvedValue(999);
      vi.mocked(mockGitHub.repoName).mockResolvedValue('owner/repo');

      await command.execute({ comment: true, pr: '456' });

      expect(mockGitHub.viewPr).toHaveBeenCalledWith(456);
      expect(mockGitHub.getPrReviewComments).toHaveBeenCalledWith(456);
      expect(mockGit.currentBranch).not.toHaveBeenCalled();
    });

    it('exits with error when PR number is invalid', async () => {
      await command.execute({ comment: true, pr: 'abc' });

      expect(mockLogger.error).toHaveBeenCalledWith('Invalid PR number: abc');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('exits with error when no PR found for current branch', async () => {
      vi.mocked(mockGit.currentBranch).mockResolvedValue('feature-branch');
      vi.mocked(mockGitHub.detectPrFromBranch).mockResolvedValue(null);

      await command.execute({ comment: true });

      expect(mockLogger.error).toHaveBeenCalledWith('No PR found for branch: feature-branch');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('continues posting replies even if one fails', async () => {
      vi.mocked(mockGit.currentBranch).mockResolvedValue('issue-42-feature');
      vi.mocked(mockGitHub.detectPrFromBranch).mockResolvedValue(123);
      vi.mocked(mockGitHub.viewPr).mockResolvedValue({
        number: 123,
        title: 'Add feature',
        headRefName: 'issue-42-feature',
      });
      vi.mocked(mockGitHub.getPrReviewComments).mockResolvedValue([
        {
          id: 1,
          path: 'src/auth.ts',
          line: 42,
          start_line: null,
          body: 'Comment 1',
          diff_hunk: '@@ -40,3 +40,5 @@',
          user: { login: 'reviewer' },
        },
        {
          id: 2,
          path: 'src/utils.ts',
          line: 15,
          start_line: null,
          body: 'Comment 2',
          diff_hunk: '@@ -13,2 +13,4 @@',
          user: { login: 'reviewer' },
        },
      ]);
      vi.mocked(mockGitHub.replyToPrReviewComment)
        .mockRejectedValueOnce(new Error('API error'))
        .mockResolvedValueOnce(999);
      vi.mocked(mockGitHub.repoName).mockResolvedValue('owner/repo');

      await command.execute({ comment: true });

      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to post reply: API error'));
      expect(mockGitHub.replyToPrReviewComment).toHaveBeenCalledTimes(2);
    });

    it('includes file path and line in LLM prompt', async () => {
      vi.mocked(mockGit.currentBranch).mockResolvedValue('issue-42-feature');
      vi.mocked(mockGitHub.detectPrFromBranch).mockResolvedValue(123);
      vi.mocked(mockGitHub.viewPr).mockResolvedValue({
        number: 123,
        title: 'Add authentication',
        headRefName: 'issue-42-feature',
      });
      vi.mocked(mockGitHub.getPrReviewComments).mockResolvedValue([
        {
          id: 1,
          path: 'src/auth.ts',
          line: 42,
          start_line: null,
          body: 'Should add input validation here',
          diff_hunk: '@@ -40,3 +40,5 @@\n+function login() {\n+  return user;\n+}',
          user: { login: 'reviewer' },
        },
      ]);
      vi.mocked(mockGitHub.replyToPrReviewComment).mockResolvedValue(999);
      vi.mocked(mockGitHub.repoName).mockResolvedValue('owner/repo');

      await command.execute({ comment: true });

      const sessionCall = vi.mocked(mockAgent.createSession).mock.calls[0][0];
      expect(sessionCall.prompt).toContain('src/auth.ts');
      expect(sessionCall.prompt).toContain('Line: 42');
      expect(sessionCall.prompt).toContain('Should add input validation here');
      expect(sessionCall.prompt).toContain('function login()');
    });
  });
});
