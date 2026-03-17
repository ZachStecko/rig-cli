import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReviewCommand } from '../../src/commands/review.command.js';
import { Logger } from '../../src/services/logger.service.js';
import { ConfigManager } from '../../src/services/config-manager.service.js';
import { StateManager } from '../../src/services/state-manager.service.js';
import { GitService } from '../../src/services/git.service.js';
import { GitHubService } from '../../src/services/github.service.js';
import { GuardService } from '../../src/services/guard.service.js';
import { EventEmitter } from 'events';

// Mock autoCommitRigState (must be first to avoid hoisting issues)
vi.mock('../../src/utils/git.js', () => ({
  autoCommitRigState: vi.fn(),
}));

// Mock PromptBuilderService
const mockPromptBuilder = {
  assembleReviewPrompt: vi.fn(),
  detectComponent: vi.fn().mockReturnValue('fullstack'),
  buildAllowedTools: vi.fn().mockReturnValue('Read,Write,Bash,Grep,Glob'),
};

vi.mock('../../src/services/prompt-builder.service.js', () => ({
  PromptBuilderService: vi.fn(() => mockPromptBuilder),
}));

// Mock fs module
vi.mock('fs', () => ({
  readFile: vi.fn(),
  existsSync: vi.fn(),
}));

// Mock readline module
const mockReadlineInterface = {
  question: vi.fn(),
  close: vi.fn(),
};

vi.mock('readline', () => ({
  createInterface: vi.fn(() => mockReadlineInterface),
}));

// Mock createAgent factory
const mockAgentSession = {
  events: (async function* () {
    yield { type: 'text', content: 'Agent running...' };
  })(),
  cancel: vi.fn(),
};

const mockAgent = {
  isAvailable: vi.fn().mockResolvedValue(true),
  checkAuth: vi.fn().mockResolvedValue({ authenticated: true, method: 'api_key' }),
  createSession: vi.fn().mockResolvedValue(mockAgentSession),
};

vi.mock('../../src/services/agents/agent-factory.js', () => ({
  createAgent: vi.fn(() => mockAgent),
}));

// Import mocked function after vi.mock to get the reference
const { autoCommitRigState: mockAutoCommitRigState } = await import('../../src/utils/git.js');

describe('ReviewCommand', () => {
  let command: ReviewCommand;
  let mockLogger: Logger;
  let mockConfig: ConfigManager;
  let mockState: StateManager;
  let mockGit: GitService;
  let mockGitHub: GitHubService;
  let mockGuard: GuardService;
  let consoleLogSpy: any;
  let exitSpy: any;

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
      repoRoot: vi.fn().mockResolvedValue('/test/project'),
    } as any;

    mockGitHub = {
      viewIssue: vi.fn().mockResolvedValue({
        number: 42,
        title: 'Test Issue',
        labels: [{ name: 'fullstack' }],
      }),
      viewPr: vi.fn().mockResolvedValue({
        number: 123,
        title: 'Test PR',
        body: 'Test PR body',
        headRefName: 'issue-42-test-issue',
      }),
    } as any;

    mockGuard = {
      requireGhAuth: vi.fn(),
    } as any;

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

    // Reset all mocks
    vi.clearAllMocks();
    vi.mocked(mockAutoCommitRigState).mockReset();
    vi.mocked(mockAutoCommitRigState).mockResolvedValue({ committed: false });

    command = new ReviewCommand(
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

    it('uses --pr option to extract issue from PR branch name', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(false);
      vi.mocked(mockGitHub.viewPr).mockResolvedValue({
        number: 123,
        title: 'Add user dashboard',
        body: 'Test PR body',
        headRefName: 'issue-42-add-user-dashboard',
      });
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 42,
        title: 'Add user dashboard',
        labels: [{ name: 'fullstack' }],
      });
      vi.mocked(mockPromptBuilder.assembleReviewPrompt).mockResolvedValue(
        'Review prompt for issue 42. Review file: `.rig-reviews/issue-42/review-2024-01-01-120000.md`'
      );

      await command.execute({ pr: '123' });

      expect(mockGitHub.viewPr).toHaveBeenCalledWith(123);
      expect(mockGitHub.viewIssue).toHaveBeenCalledWith(42);
      expect(mockPromptBuilder.assembleReviewPrompt).toHaveBeenCalledWith(42);
    });

    it('exits with error when --pr has invalid branch format', async () => {
      vi.mocked(mockGitHub.viewPr).mockResolvedValue({
        number: 123,
        title: 'Test PR',
        body: 'Test PR body',
        headRefName: 'feature-invalid-branch',
      });

      await command.execute({ pr: '123' });

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Cannot determine issue number from PR #123 branch: feature-invalid-branch'
      );
      expect(mockLogger.info).toHaveBeenCalledWith('Branch name must start with "issue-{number}" format.');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('exits with error when --pr has invalid PR number', async () => {
      await command.execute({ pr: 'abc' });

      expect(mockLogger.error).toHaveBeenCalledWith('Invalid PR number: abc');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('uses --issue option to review specific issue', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(false);
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 99,
        title: 'Add feature X',
        labels: [{ name: 'backend' }],
      });
      vi.mocked(mockPromptBuilder.assembleReviewPrompt).mockResolvedValue(
        'Review prompt for issue 99. Review file: `.rig-reviews/issue-99/review-2024-01-01-120000.md`'
      );

      // Mock successful review with no findings
      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      // Trigger process completion after a short delay
      setTimeout(() => mockProcess.emit('close', 0), 10);

      // Mock file reading
      const fs = await import('fs');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockImplementation((path, encoding, callback: any) => {
        callback(null, '## Verdict: PASS\n\n## Findings\n\nNo findings.');
      });

      await command.execute({ issue: '99' });

      expect(mockPromptBuilder.assembleReviewPrompt).toHaveBeenCalledWith(99);
    });

    it('errors on invalid issue number', async () => {
      await command.execute({ issue: 'abc' });

      expect(mockLogger.error).toHaveBeenCalledWith('Invalid issue number: abc');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('handles dry-run mode', async () => {
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
          pr: 'in_progress',
          review: 'pending',
        },
      });
      vi.mocked(mockPromptBuilder.assembleReviewPrompt).mockResolvedValue(
        'Review prompt. File: `.rig-reviews/issue-42/review-2024-01-01-120000.md`'
      );

      await command.execute({ dryRun: true });

      expect(mockLogger.warn).toHaveBeenCalledWith('[DRY RUN MODE - No changes will be made]');
      expect(mockLogger.success).toHaveBeenCalledWith('Dry-run complete. Use without --dry-run to execute.');
      expect(mockAgent.createSession).not.toHaveBeenCalled();
    });

    it('displays header with issue info', async () => {
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
          pr: 'in_progress',
          review: 'pending',
        },
      });
      vi.mocked(mockPromptBuilder.assembleReviewPrompt).mockResolvedValue(
        'Review prompt. File: `.rig-reviews/issue-42/review-2024-01-01-120000.md`'
      );

      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      setTimeout(() => mockProcess.emit('close', 0), 10);

      const fs = await import('fs');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockImplementation((path, encoding, callback: any) => {
        callback(null, '## Verdict: PASS\n\n## Findings\n\nNo findings.');
      });

      await command.execute();

      expect(mockLogger.header).toHaveBeenCalledWith('Code Review for Issue #42');
      expect(mockLogger.info).toHaveBeenCalledWith('Issue: Add user dashboard');
    });

    it('updates state to in_progress before running review', async () => {
      const initialState = {
        issue_number: 42,
        issue_title: 'Add user dashboard',
        stage: 'pr' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'completed' as const,
          test: 'completed' as const,
          pr: 'completed' as const,
          review: 'pending' as const,
        },
      };

      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({ ...initialState });
      vi.mocked(mockPromptBuilder.assembleReviewPrompt).mockResolvedValue(
        'Review prompt. File: `.rig-reviews/issue-42/review-2024-01-01-120000.md`'
      );

      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      setTimeout(() => mockProcess.emit('close', 0), 10);

      const fs = await import('fs');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockImplementation((path, encoding, callback: any) => {
        callback(null, '## Verdict: PASS\n\n## Findings\n\nNo findings.');
      });

      await command.execute();

      // Check that state was written twice
      expect(mockState.write).toHaveBeenCalledTimes(2);

      // Check first write call (should mark review as in_progress)
      const firstCall = vi.mocked(mockState.write).mock.calls[0][0];
      expect(firstCall.stage).toBe('review');
      expect(firstCall.stages.review).toBe('in_progress');
    });

    it('marks review as completed on success', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user dashboard',
        stage: 'review' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'completed' as const,
          test: 'completed' as const,
          pr: 'completed' as const,
          review: 'in_progress' as const,
        },
      });
      vi.mocked(mockPromptBuilder.assembleReviewPrompt).mockResolvedValue(
        'Review prompt. File: `.rig-reviews/issue-42/review-2024-01-01-120000.md`'
      );

      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      setTimeout(() => mockProcess.emit('close', 0), 10);

      const fs = await import('fs');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockImplementation((path, encoding, callback: any) => {
        callback(null, '## Verdict: PASS\n\n## Findings\n\nNo findings.');
      });

      await command.execute();

      // Check second write call (should mark review as completed)
      expect(mockState.write).toHaveBeenNthCalledWith(2, expect.objectContaining({
        stages: expect.objectContaining({
          review: 'completed',
        }),
      }));
    });

    it('marks review as failed on error', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user dashboard',
        stage: 'review' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'completed' as const,
          test: 'completed' as const,
          pr: 'completed' as const,
          review: 'in_progress' as const,
        },
      });
      vi.mocked(mockPromptBuilder.assembleReviewPrompt).mockResolvedValue(
        'Review prompt. File: `.rig-reviews/issue-42/review-2024-01-01-120000.md`'
      );

      // Provide fresh agent session and ensure review file doesn't exist
      mockAgent.createSession.mockResolvedValue({
        events: (async function* () {
          yield { type: 'text', content: 'Agent running...' };
        })(),
        cancel: vi.fn(),
      });

      const fs = await import('fs');
      vi.mocked(fs.existsSync).mockReturnValue(false);

      await command.execute();

      // Check second write call (should mark review as failed)
      expect(mockState.write).toHaveBeenNthCalledWith(2, expect.objectContaining({
        stages: expect.objectContaining({
          review: 'failed',
        }),
      }));

      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Review failed:'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('displays progress steps during execution', async () => {
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
          review: 'in_progress',
        },
      });
      vi.mocked(mockPromptBuilder.assembleReviewPrompt).mockResolvedValue(
        'Review prompt. File: `.rig-reviews/issue-42/review-2024-01-01-120000.md`'
      );

      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      setTimeout(() => mockProcess.emit('close', 0), 10);

      const fs = await import('fs');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockImplementation((path, encoding, callback: any) => {
        callback(null, '## Verdict: PASS\n\n## Findings\n\nNo findings.');
      });

      await command.execute();

      expect(mockLogger.step).toHaveBeenCalledWith(1, 3, 'Assembling review prompt...');
      expect(mockLogger.step).toHaveBeenCalledWith(2, 3, 'Running code review agent...');
      expect(mockLogger.step).toHaveBeenCalledWith(3, 3, 'Parsing review and triaging findings...');
    });

    it('parses review verdict and findings', async () => {
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
          review: 'in_progress',
        },
      });
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 42,
        title: 'Add user dashboard',
        labels: [{ name: 'fullstack' }],
      });
      vi.mocked(mockPromptBuilder.assembleReviewPrompt).mockResolvedValue(
        'Review prompt. File: `.rig-reviews/issue-42/review-2024-01-01-120000.md`'
      );

      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      setTimeout(() => mockProcess.emit('close', 0), 10);

      const fs = await import('fs');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockImplementation((path, encoding, callback: any) => {
        callback(null, `## Verdict: REJECT

## Findings

**[high]** Critical security vulnerability in auth.ts:42
- Lens: Skeptic
- Principle: Security
- Recommendation: Add input validation

**[medium]** Performance issue in query.ts:15
- Lens: Architect
- Principle: Performance
- Recommendation: Add caching`);
      });

      // Mock readline to answer "n" (skip) for both findings
      let questionCount = 0;
      vi.mocked(mockReadlineInterface.question).mockImplementation((q, callback) => {
        questionCount++;
        // Answer "n" twice (skip both findings), then done
        callback(questionCount <= 2 ? 'n' : '');
      });

      await command.execute();

      expect(mockLogger.info).toHaveBeenCalledWith('Verdict: REJECT');
      expect(mockLogger.info).toHaveBeenCalledWith('Findings: 2 (1 high, 1 medium, 0 low)');
    });

    it('auto-commits state changes after successful review', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user dashboard',
        stage: 'review' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'completed' as const,
          test: 'completed' as const,
          pr: 'completed' as const,
          review: 'in_progress' as const,
        },
      });
      vi.mocked(mockPromptBuilder.assembleReviewPrompt).mockResolvedValue(
        'Review prompt. File: `.rig-reviews/issue-42/review-2024-01-01-120000.md`'
      );
      vi.mocked(mockAutoCommitRigState).mockResolvedValue({ committed: true });

      const fs = await import('fs');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockImplementation((path, encoding, callback: any) => {
        callback(null, '## Verdict: PASS\n\n## Findings\n\nNo findings.');
      });

      await command.execute();

      expect(mockAutoCommitRigState).toHaveBeenCalledWith('/test/project');
      expect(mockLogger.dim).toHaveBeenCalledWith('State changes committed to git');
    });

    it('warns when state is in gitignore', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user dashboard',
        stage: 'review' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'completed' as const,
          test: 'completed' as const,
          pr: 'completed' as const,
          review: 'in_progress' as const,
        },
      });
      vi.mocked(mockPromptBuilder.assembleReviewPrompt).mockResolvedValue(
        'Review prompt. File: `.rig-reviews/issue-42/review-2024-01-01-120000.md`'
      );
      vi.mocked(mockAutoCommitRigState).mockResolvedValue({
        committed: false,
        message: 'Warning: .rig-state.json is in .gitignore and will not be committed.'
      });

      const fs = await import('fs');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockImplementation((path, encoding, callback: any) => {
        callback(null, '## Verdict: PASS\n\n## Findings\n\nNo findings.');
      });

      await command.execute();

      expect(mockAutoCommitRigState).toHaveBeenCalledWith('/test/project');
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('.rig-state.json is in .gitignore'));
    });

    it('auto-commits state changes after failed review', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user dashboard',
        stage: 'review' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'completed' as const,
          test: 'completed' as const,
          pr: 'completed' as const,
          review: 'in_progress' as const,
        },
      });
      vi.mocked(mockPromptBuilder.assembleReviewPrompt).mockResolvedValue(
        'Review prompt. File: `.rig-reviews/issue-42/review-2024-01-01-120000.md`'
      );
      vi.mocked(mockAutoCommitRigState).mockResolvedValue({ committed: true });

      mockAgent.createSession.mockResolvedValue({
        events: (async function* () {
          yield { type: 'text', content: 'Agent running...' };
        })(),
        cancel: vi.fn(),
      });

      const fs = await import('fs');
      vi.mocked(fs.existsSync).mockReturnValue(false);

      await command.execute();

      expect(mockAutoCommitRigState).toHaveBeenCalledWith('/test/project');
      expect(mockLogger.dim).toHaveBeenCalledWith('State changes committed to git');
    });

    it('handles auto-commit errors gracefully', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user dashboard',
        stage: 'review' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'completed' as const,
          test: 'completed' as const,
          pr: 'completed' as const,
          review: 'in_progress' as const,
        },
      });
      vi.mocked(mockPromptBuilder.assembleReviewPrompt).mockResolvedValue(
        'Review prompt. File: `.rig-reviews/issue-42/review-2024-01-01-120000.md`'
      );
      vi.mocked(mockAutoCommitRigState).mockRejectedValue(new Error('Git user.name not configured'));

      const fs = await import('fs');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockImplementation((path, encoding, callback: any) => {
        callback(null, '## Verdict: PASS\n\n## Findings\n\nNo findings.');
      });

      await command.execute();

      expect(mockAutoCommitRigState).toHaveBeenCalledWith('/test/project');
      expect(mockLogger.warn).toHaveBeenCalledWith('Could not auto-commit state: Git user.name not configured');
      expect(mockLogger.success).toHaveBeenCalledWith('Code review completed for issue #42');
    });
  });
});
