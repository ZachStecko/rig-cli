import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReviewCommand } from '../../src/commands/review.command.js';
import { Logger } from '../../src/services/logger.service.js';
import { ConfigManager } from '../../src/services/config-manager.service.js';
import { StateManager } from '../../src/services/state-manager.service.js';
import { GitService } from '../../src/services/git.service.js';
import { GitHubService } from '../../src/services/github.service.js';
import { GuardService } from '../../src/services/guard.service.js';
import { EventEmitter } from 'events';

// Mock ClaudeService
const mockClaude = {
  isInstalled: vi.fn(),
  run: vi.fn(),
};

vi.mock('../../src/services/claude.service.js', () => ({
  ClaudeService: vi.fn(() => mockClaude),
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
    } as any;

    mockGitHub = {
      viewIssue: vi.fn().mockResolvedValue({
        number: 42,
        title: 'Test Issue',
        labels: [{ name: 'fullstack' }],
      }),
    } as any;

    mockGuard = {
      requireGhAuth: vi.fn(),
    } as any;

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

    // Reset all mocks
    vi.clearAllMocks();

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

    it('exits with error when --pr option is used', async () => {
      await command.execute({ pr: '123' });

      expect(mockLogger.error).toHaveBeenCalledWith('--pr option not yet implemented. Use --issue instead.');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('uses --issue option to review specific issue', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(false);
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 99,
        title: 'Add feature X',
        labels: [{ name: 'backend' }],
      });
      vi.mocked(mockClaude.isInstalled).mockResolvedValue(true);
      vi.mocked(mockPromptBuilder.assembleReviewPrompt).mockResolvedValue(
        'Review prompt for issue 99. Review file: `.rig-reviews/issue-99/review-2024-01-01-120000.md`'
      );

      // Mock successful review with no findings
      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      vi.mocked(mockClaude.run).mockResolvedValue(mockProcess);

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

    it('exits when Claude is not installed', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user dashboard',
        stage: 'pr',
      });
      vi.mocked(mockClaude.isInstalled).mockResolvedValue(false);

      await command.execute();

      expect(mockLogger.error).toHaveBeenCalledWith('Claude CLI is not installed. Install it first: npm install -g @anthropics/claude-cli');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('handles dry-run mode', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user dashboard',
        stage: 'pr',
      });
      vi.mocked(mockPromptBuilder.assembleReviewPrompt).mockResolvedValue(
        'Review prompt. File: `.rig-reviews/issue-42/review-2024-01-01-120000.md`'
      );

      await command.execute({ dryRun: true });

      expect(mockLogger.warn).toHaveBeenCalledWith('[DRY RUN MODE - No changes will be made]');
      expect(mockLogger.success).toHaveBeenCalledWith('Dry-run complete. Use without --dry-run to execute.');
      expect(mockClaude.run).not.toHaveBeenCalled();
    });

    it('displays header with issue info', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user dashboard',
        stage: 'pr',
      });
      vi.mocked(mockClaude.isInstalled).mockResolvedValue(true);
      vi.mocked(mockPromptBuilder.assembleReviewPrompt).mockResolvedValue(
        'Review prompt. File: `.rig-reviews/issue-42/review-2024-01-01-120000.md`'
      );

      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      vi.mocked(mockClaude.run).mockResolvedValue(mockProcess);

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
          demo: 'completed' as const,
          pr: 'completed' as const,
          review: 'pending' as const,
        },
      };

      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({ ...initialState });
      vi.mocked(mockClaude.isInstalled).mockResolvedValue(true);
      vi.mocked(mockPromptBuilder.assembleReviewPrompt).mockResolvedValue(
        'Review prompt. File: `.rig-reviews/issue-42/review-2024-01-01-120000.md`'
      );

      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      vi.mocked(mockClaude.run).mockResolvedValue(mockProcess);

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
          demo: 'completed' as const,
          pr: 'completed' as const,
          review: 'in_progress' as const,
        },
      });
      vi.mocked(mockClaude.isInstalled).mockResolvedValue(true);
      vi.mocked(mockPromptBuilder.assembleReviewPrompt).mockResolvedValue(
        'Review prompt. File: `.rig-reviews/issue-42/review-2024-01-01-120000.md`'
      );

      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      vi.mocked(mockClaude.run).mockResolvedValue(mockProcess);

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
          demo: 'completed' as const,
          pr: 'completed' as const,
          review: 'in_progress' as const,
        },
      });
      vi.mocked(mockClaude.isInstalled).mockResolvedValue(true);
      vi.mocked(mockPromptBuilder.assembleReviewPrompt).mockResolvedValue(
        'Review prompt. File: `.rig-reviews/issue-42/review-2024-01-01-120000.md`'
      );

      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      vi.mocked(mockClaude.run).mockResolvedValue(mockProcess);

      setTimeout(() => mockProcess.emit('close', 1), 10); // Exit code 1 = failure

      await command.execute();

      // Check second write call (should mark review as failed)
      expect(mockState.write).toHaveBeenNthCalledWith(2, expect.objectContaining({
        stages: expect.objectContaining({
          review: 'failed',
        }),
      }));

      expect(mockLogger.error).toHaveBeenCalledWith('Review failed: Process exited with code 1');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('displays progress steps during execution', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user dashboard',
        stage: 'review',
      });
      vi.mocked(mockClaude.isInstalled).mockResolvedValue(true);
      vi.mocked(mockPromptBuilder.assembleReviewPrompt).mockResolvedValue(
        'Review prompt. File: `.rig-reviews/issue-42/review-2024-01-01-120000.md`'
      );

      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      vi.mocked(mockClaude.run).mockResolvedValue(mockProcess);

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
        stage: 'review',
      });
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 42,
        title: 'Add user dashboard',
        labels: [{ name: 'fullstack' }],
      });
      vi.mocked(mockClaude.isInstalled).mockResolvedValue(true);
      vi.mocked(mockPromptBuilder.assembleReviewPrompt).mockResolvedValue(
        'Review prompt. File: `.rig-reviews/issue-42/review-2024-01-01-120000.md`'
      );

      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      vi.mocked(mockClaude.run).mockResolvedValue(mockProcess);

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
  });
});
