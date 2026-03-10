import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextCommand } from '../../src/commands/next.command.js';
import { Logger } from '../../src/services/logger.service.js';
import { ConfigManager } from '../../src/services/config-manager.service.js';
import { StateManager } from '../../src/services/state-manager.service.js';
import { GitService } from '../../src/services/git.service.js';
import { GitHubService } from '../../src/services/github.service.js';
import { GuardService } from '../../src/services/guard.service.js';
import { Issue } from '../../src/types/issue.types.js';

describe('NextCommand', () => {
  let command: NextCommand;
  let mockLogger: Logger;
  let mockConfig: ConfigManager;
  let mockState: StateManager;
  let mockGit: GitService;
  let mockGitHub: GitHubService;
  let mockGuard: GuardService;
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
      ensureDirs: vi.fn(),
    } as any;

    mockGit = {
      currentBranch: vi.fn(),
      createBranch: vi.fn(),
    } as any;

    mockGitHub = {
      listIssues: vi.fn(),
      hasOpenPr: vi.fn(),
      viewIssue: vi.fn(),
    } as any;

    mockGuard = {
      requireGhAuth: vi.fn(),
    } as any;

    // Mock process.exit
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

    command = new NextCommand(
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
      vi.mocked(mockGitHub.listIssues).mockResolvedValue([]);

      await command.execute();

      expect(mockGuard.requireGhAuth).toHaveBeenCalled();
    });

    it('displays header', async () => {
      vi.mocked(mockGitHub.listIssues).mockResolvedValue([]);

      await command.execute();

      expect(mockLogger.header).toHaveBeenCalledWith('Picking Next Issue');
    });

    it('exits with warning when no eligible issues found', async () => {
      vi.mocked(mockGitHub.listIssues).mockResolvedValue([]);
      vi.mocked(mockGitHub.hasOpenPr).mockResolvedValue(false);

      await command.execute();

      expect(mockLogger.warn).toHaveBeenCalledWith('No eligible issues found in the queue.');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('selects next issue and displays it', async () => {
      const mockIssues = [
        {
          number: 42,
          title: 'Add user authentication',
          labels: [{ name: 'backend' }, { name: 'Phase 1: MVP' }, { name: 'p0' }],
        },
      ];

      vi.mocked(mockGitHub.listIssues).mockResolvedValue(mockIssues as any);
      vi.mocked(mockGitHub.hasOpenPr).mockResolvedValue(false);
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue(mockIssues[0] as any);

      await command.execute();

      expect(mockLogger.success).toHaveBeenCalledWith('Selected issue #42: Add user authentication');
    });

    it('displays labels when present', async () => {
      const mockIssues = [
        {
          number: 42,
          title: 'Add user authentication',
          labels: [{ name: 'backend' }, { name: 'p0' }],
        },
      ];

      vi.mocked(mockGitHub.listIssues).mockResolvedValue(mockIssues as any);
      vi.mocked(mockGitHub.hasOpenPr).mockResolvedValue(false);
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue(mockIssues[0] as any);

      await command.execute();

      expect(mockLogger.dim).toHaveBeenCalledWith('  Labels: backend, p0');
    });

    it('generates branch name from slugified title', async () => {
      const mockIssues = [
        {
          number: 42,
          title: 'Add User Authentication & Authorization',
          labels: [{ name: 'backend' }],
        },
      ];

      vi.mocked(mockGitHub.listIssues).mockResolvedValue(mockIssues as any);
      vi.mocked(mockGitHub.hasOpenPr).mockResolvedValue(false);
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue(mockIssues[0] as any);

      await command.execute();

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Branch name: issue-42-add-user-authentication-authorization'
      );
    });

    it('creates initial pipeline state', async () => {
      const mockIssues = [
        {
          number: 42,
          title: 'Add user authentication',
          labels: [{ name: 'backend' }],
        },
      ];

      vi.mocked(mockGitHub.listIssues).mockResolvedValue(mockIssues as any);
      vi.mocked(mockGitHub.hasOpenPr).mockResolvedValue(false);
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue(mockIssues[0] as any);

      await command.execute();

      expect(mockState.write).toHaveBeenCalledWith({
        issue_number: 42,
        issue_title: 'Add user authentication',
        branch: 'issue-42-add-user-authentication',
        stage: 'pick',
        stages: {
          pick: 'completed',
          branch: 'pending',
          implement: 'pending',
          test: 'pending',
          demo: 'pending',
          pr: 'pending',
          review: 'pending',
        },
      });
    });

    it('ensures supporting directories exist', async () => {
      const mockIssues = [
        {
          number: 42,
          title: 'Add user authentication',
          labels: [{ name: 'backend' }],
        },
      ];

      vi.mocked(mockGitHub.listIssues).mockResolvedValue(mockIssues as any);
      vi.mocked(mockGitHub.hasOpenPr).mockResolvedValue(false);
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue(mockIssues[0] as any);

      await command.execute();

      expect(mockState.ensureDirs).toHaveBeenCalled();
    });

    it('displays next steps after saving state', async () => {
      const mockIssues = [
        {
          number: 42,
          title: 'Add user authentication',
          labels: [{ name: 'backend' }],
        },
      ];

      vi.mocked(mockGitHub.listIssues).mockResolvedValue(mockIssues as any);
      vi.mocked(mockGitHub.hasOpenPr).mockResolvedValue(false);
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue(mockIssues[0] as any);

      await command.execute();

      expect(mockLogger.info).toHaveBeenCalledWith("State saved. Ready to begin implementation.");
    });

    it('passes phase filter to issue queue service', async () => {
      const mockIssues = [
        {
          number: 42,
          title: 'Phase 1 issue',
          labels: [{ name: 'Phase 1: MVP' }, { name: 'backend' }],
        },
      ];

      vi.mocked(mockGitHub.listIssues).mockResolvedValue(mockIssues as any);
      vi.mocked(mockGitHub.hasOpenPr).mockResolvedValue(false);
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue(mockIssues[0] as any);

      await command.execute({ phase: 'Phase 1: MVP' });

      expect(mockGitHub.listIssues).toHaveBeenCalled();
    });

    it('passes component filter to issue queue service', async () => {
      const mockIssues = [
        {
          number: 42,
          title: 'Backend issue',
          labels: [{ name: 'backend' }, { name: 'Phase 1: MVP' }],
        },
      ];

      vi.mocked(mockGitHub.listIssues).mockResolvedValue(mockIssues as any);
      vi.mocked(mockGitHub.hasOpenPr).mockResolvedValue(false);
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue(mockIssues[0] as any);

      await command.execute({ component: 'backend' });

      expect(mockGitHub.listIssues).toHaveBeenCalled();
    });

    it('skips issues with open PRs', async () => {
      const mockIssues = [
        {
          number: 42,
          title: 'Issue with open PR',
          labels: [{ name: 'backend' }],
        },
        {
          number: 43,
          title: 'Issue without open PR',
          labels: [{ name: 'backend' }],
        },
      ];

      vi.mocked(mockGitHub.listIssues).mockResolvedValue(mockIssues as any);
      vi.mocked(mockGitHub.hasOpenPr)
        .mockResolvedValueOnce(true)  // #42 has open PR
        .mockResolvedValueOnce(false); // #43 does not
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue(mockIssues[1] as any);

      await command.execute();

      // Should select #43, not #42
      expect(mockLogger.success).toHaveBeenCalledWith('Selected issue #43: Issue without open PR');
    });

    it('handles very long titles in branch names', async () => {
      const longTitle = 'This is a very long issue title that should be truncated to fit within the fifty character limit for branch names';
      const mockIssues = [
        {
          number: 42,
          title: longTitle,
          labels: [{ name: 'backend' }],
        },
      ];

      vi.mocked(mockGitHub.listIssues).mockResolvedValue(mockIssues as any);
      vi.mocked(mockGitHub.hasOpenPr).mockResolvedValue(false);
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue(mockIssues[0] as any);

      await command.execute();

      // Branch name should be truncated (slugify limits to 50 chars)
      const branchCall = vi.mocked(mockState.write).mock.calls[0][0];
      expect(branchCall.branch.length).toBeLessThanOrEqual(60); // issue-42- + 50 chars
    });

    it('handles special characters in titles', async () => {
      const mockIssues = [
        {
          number: 42,
          title: 'Fix bug: API/endpoint (v2.0) fails!',
          labels: [{ name: 'backend' }],
        },
      ];

      vi.mocked(mockGitHub.listIssues).mockResolvedValue(mockIssues as any);
      vi.mocked(mockGitHub.hasOpenPr).mockResolvedValue(false);
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue(mockIssues[0] as any);

      await command.execute();

      // Branch name should have special characters replaced with hyphens
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Branch name: issue-42-fix-bug-api-endpoint-v2-0-fails'
      );
    });

    it('handles issues with no labels', async () => {
      const mockIssues = [
        {
          number: 42,
          title: 'Unlabeled issue',
          labels: [],
        },
      ];

      vi.mocked(mockGitHub.listIssues).mockResolvedValue(mockIssues as any);
      vi.mocked(mockGitHub.hasOpenPr).mockResolvedValue(false);
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue(mockIssues[0] as any);

      await command.execute();

      // Should not display labels section
      expect(mockLogger.success).toHaveBeenCalledWith('Selected issue #42: Unlabeled issue');
      // Should not call dim with labels
      const dimCalls = vi.mocked(mockLogger.dim).mock.calls;
      const labelsCall = dimCalls.find(call => call[0].includes('Labels:'));
      expect(labelsCall).toBeUndefined();
    });

    it('writes state before displaying next steps', async () => {
      const mockIssues = [
        {
          number: 42,
          title: 'Add user authentication',
          labels: [{ name: 'backend' }],
        },
      ];

      vi.mocked(mockGitHub.listIssues).mockResolvedValue(mockIssues as any);
      vi.mocked(mockGitHub.hasOpenPr).mockResolvedValue(false);
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue(mockIssues[0] as any);

      await command.execute();

      // Verify write happens before info message
      const writeCall = vi.mocked(mockState.write).mock.invocationCallOrder[0];
      const infoCalls = vi.mocked(mockLogger.info).mock.invocationCallOrder;
      const nextStepsCall = infoCalls[infoCalls.length - 1];

      expect(writeCall).toBeLessThan(nextStepsCall);
    });
  });
});
