import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueueCommand } from '../../src/commands/queue.command.js';
import { Logger } from '../../src/services/logger.service.js';
import { ConfigManager } from '../../src/services/config-manager.service.js';
import { StateManager } from '../../src/services/state-manager.service.js';
import { GitService } from '../../src/services/git.service.js';
import { GitHubService } from '../../src/services/github.service.js';
import { GuardService } from '../../src/services/guard.service.js';

describe('QueueCommand', () => {
  let command: QueueCommand;
  let mockLogger: Logger;
  let mockConfig: ConfigManager;
  let mockState: StateManager;
  let mockGit: GitService;
  let mockGitHub: GitHubService;
  let mockGuard: GuardService;
  let consoleLogSpy: any;

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
    } as any;

    mockGit = {
      currentBranch: vi.fn(),
    } as any;

    mockGitHub = {
      listIssues: vi.fn(),
      hasOpenPr: vi.fn(),
    } as any;

    mockGuard = {
      requireGhAuth: vi.fn(),
    } as any;

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    command = new QueueCommand(
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
  });

  describe('execute', () => {
    it('checks GitHub authentication before fetching issues', async () => {
      vi.mocked(mockGitHub.listIssues).mockResolvedValue([]);

      await command.execute();

      expect(mockGuard.requireGhAuth).toHaveBeenCalled();
    });

    it('displays header', async () => {
      vi.mocked(mockGitHub.listIssues).mockResolvedValue([]);

      await command.execute();

      expect(mockLogger.header).toHaveBeenCalledWith('Issue Queue');
    });

    it('shows warning when no issues found', async () => {
      vi.mocked(mockGitHub.listIssues).mockResolvedValue([]);

      await command.execute();

      expect(mockLogger.warn).toHaveBeenCalledWith('No eligible issues found.');
    });

    it('displays issues in a formatted table', async () => {
      const mockIssues = [
        {
          number: 42,
          title: 'Add user authentication',
          labels: [{ name: 'backend' }, { name: 'Phase 1: MVP' }, { name: 'p0' }],
        },
        {
          number: 38,
          title: 'Fix navbar styling',
          labels: [{ name: 'frontend' }, { name: 'Phase 1: MVP' }, { name: 'p1' }],
        },
        {
          number: 25,
          title: 'Refactor database layer',
          labels: [{ name: 'backend' }, { name: 'Phase 2: Enhancement' }, { name: 'p2' }],
        },
      ];

      vi.mocked(mockGitHub.listIssues).mockResolvedValue(mockIssues as any);
      vi.mocked(mockGitHub.hasOpenPr).mockResolvedValue(false);

      await command.execute();

      // Verify table header
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('#'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Title'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Labels'));

      // Verify table separator
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('─'));

      // Verify issue data is displayed
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('#42'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Add user authentication'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('#38'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Fix navbar styling'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('#25'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Refactor database layer'));

      // Verify issue count
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('3 issues in queue'));
    });

    it('marks first issue with arrow', async () => {
      const mockIssues = [
        {
          number: 42,
          title: 'Add user authentication',
          labels: [{ name: 'backend' }, { name: 'Phase 1: MVP' }, { name: 'p0' }],
        },
        {
          number: 38,
          title: 'Fix navbar styling',
          labels: [{ name: 'frontend' }, { name: 'Phase 1: MVP' }, { name: 'p1' }],
        },
      ];

      vi.mocked(mockGitHub.listIssues).mockResolvedValue(mockIssues as any);
      vi.mocked(mockGitHub.hasOpenPr).mockResolvedValue(false);

      await command.execute();

      // Check that first issue is marked with →
      const calls = consoleLogSpy.mock.calls.map((call: any) => call[0]);
      const issue42Line = calls.find((line: string) => line.includes('#42'));
      const issue38Line = calls.find((line: string) => line.includes('#38'));

      expect(issue42Line).toContain('→');
      expect(issue38Line).not.toContain('→');
    });

    it('truncates long titles to 58 characters', async () => {
      const longTitle = 'This is a very long issue title that should be truncated to fit in the table column width';
      const mockIssues = [
        {
          number: 42,
          title: longTitle,
          labels: [{ name: 'backend' }],
        },
      ];

      vi.mocked(mockGitHub.listIssues).mockResolvedValue(mockIssues as any);
      vi.mocked(mockGitHub.hasOpenPr).mockResolvedValue(false);

      await command.execute();

      // Verify title is truncated
      const calls = consoleLogSpy.mock.calls.map((call: any) => call[0]);
      const issue42Line = calls.find((line: string) => line.includes('#42'));

      // Should not contain the full long title
      expect(issue42Line).not.toContain(longTitle);
      // Should contain the truncated version
      expect(issue42Line).toContain(longTitle.slice(0, 58));
    });

    it('truncates long labels with ellipsis', async () => {
      const mockIssues = [
        {
          number: 42,
          title: 'Test issue',
          labels: [
            { name: 'backend' },
            { name: 'frontend' },
            { name: 'Phase 1: MVP' },
            { name: 'Phase 2: Enhancement' },
            { name: 'p0' },
            { name: 'p1' },
            { name: 'bug' },
            { name: 'feature' },
          ],
        },
      ];

      vi.mocked(mockGitHub.listIssues).mockResolvedValue(mockIssues as any);
      vi.mocked(mockGitHub.hasOpenPr).mockResolvedValue(false);

      await command.execute();

      // Verify labels are truncated with ...
      const calls = consoleLogSpy.mock.calls.map((call: any) => call[0]);
      const issue42Line = calls.find((line: string) => line.includes('#42'));

      expect(issue42Line).toContain('...');
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

      await command.execute({ phase: 'Phase 1: MVP' });

      // IssueQueueService will call listIssues and filter internally
      expect(mockGitHub.listIssues).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('#42'));
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

      await command.execute({ component: 'backend' });

      expect(mockGitHub.listIssues).toHaveBeenCalled();
    });

    it('handles both phase and component filters together', async () => {
      const mockIssues = [
        {
          number: 42,
          title: 'Backend Phase 1 issue',
          labels: [{ name: 'backend' }, { name: 'Phase 1: MVP' }, { name: 'p0' }],
        },
      ];

      vi.mocked(mockGitHub.listIssues).mockResolvedValue(mockIssues as any);
      vi.mocked(mockGitHub.hasOpenPr).mockResolvedValue(false);

      await command.execute({ phase: 'Phase 1: MVP', component: 'backend' });

      expect(mockGitHub.listIssues).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('#42'));
    });

    it('filters out epic issues', async () => {
      const mockIssues = [
        {
          number: 42,
          title: 'Regular issue',
          labels: [{ name: 'backend' }],
        },
        {
          number: 43,
          title: 'Epic issue',
          labels: [{ name: 'epic' }],
        },
      ];

      vi.mocked(mockGitHub.listIssues).mockResolvedValue(mockIssues as any);
      vi.mocked(mockGitHub.hasOpenPr).mockResolvedValue(false);

      await command.execute();

      // Should display regular issue
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('#42'));
      // Should not display epic issue
      const calls = consoleLogSpy.mock.calls.map((call: any) => call[0]);
      const hasEpic = calls.some((line: string) => line.includes('#43'));
      expect(hasEpic).toBe(false);
    });

    it('displays issues in score-sorted order', async () => {
      const mockIssues = [
        {
          number: 25,
          title: 'Lower priority',
          labels: [{ name: 'Phase 2: Enhancement' }, { name: 'p2' }],
        },
        {
          number: 42,
          title: 'Higher priority',
          labels: [{ name: 'Phase 1: MVP' }, { name: 'p0' }],
        },
        {
          number: 38,
          title: 'Medium priority',
          labels: [{ name: 'Phase 1: MVP' }, { name: 'p1' }],
        },
      ];

      vi.mocked(mockGitHub.listIssues).mockResolvedValue(mockIssues as any);
      vi.mocked(mockGitHub.hasOpenPr).mockResolvedValue(false);

      await command.execute();

      // Get all console.log calls
      const calls = consoleLogSpy.mock.calls.map((call: any) => call[0]);

      // Find index of each issue in output
      const idx42 = calls.findIndex((line: string) => line.includes('#42'));
      const idx38 = calls.findIndex((line: string) => line.includes('#38'));
      const idx25 = calls.findIndex((line: string) => line.includes('#25'));

      // Verify sorted order: #42 (Phase 1 p0) > #38 (Phase 1 p1) > #25 (Phase 2 p2)
      expect(idx42).toBeGreaterThan(-1);
      expect(idx38).toBeGreaterThan(-1);
      expect(idx25).toBeGreaterThan(-1);
      expect(idx42).toBeLessThan(idx38);
      expect(idx38).toBeLessThan(idx25);

      // First issue should be marked with arrow
      expect(calls[idx42]).toContain('→');
    });
  });
});
