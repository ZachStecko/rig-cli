import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GrabCommand } from '../../src/commands/grab.command.js';
import { Logger } from '../../src/services/logger.service.js';
import { ConfigManager } from '../../src/services/config-manager.service.js';
import { GitService } from '../../src/services/git.service.js';
import { GitHubService } from '../../src/services/github.service.js';
import { GuardService } from '../../src/services/guard.service.js';
import { copyToClipboard } from '../../src/utils/clipboard.js';

vi.mock('../../src/utils/clipboard.js', () => ({
  copyToClipboard: vi.fn(),
}));

describe('GrabCommand', () => {
  let command: GrabCommand;
  let mockLogger: Logger;
  let mockConfig: ConfigManager;
  let mockGit: GitService;
  let mockGitHub: GitHubService;
  let mockGuard: GuardService;
  let consoleLogSpy: any;
  let exitSpy: any;

  const issue = {
    number: 42,
    title: 'cli: add clipboard support',
    body: '## Problem\n\nStuff is hard to copy.',
    labels: [],
  };

  beforeEach(() => {
    mockLogger = {
      header: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      dim: vi.fn(),
    } as any;

    mockConfig = {
      load: vi.fn(),
      get: vi.fn().mockReturnValue({}),
    } as any;

    mockGit = {} as any;

    mockGitHub = {
      viewIssue: vi.fn().mockResolvedValue(issue),
      listOpenIssues: vi.fn().mockResolvedValue([
        { number: 42, title: 'cli: add clipboard support', labels: [{ name: 'cli' }] },
        { number: 43, title: 'api: fix rate limiting', labels: [] },
      ]),
    } as any;

    mockGuard = {
      requireGhAuth: vi.fn(),
    } as any;

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);
    vi.mocked(copyToClipboard).mockResolvedValue(undefined);

    command = new GrabCommand(
      mockLogger,
      mockConfig,
      mockGit,
      mockGitHub,
      mockGuard,
      '/test/project'
    );
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    exitSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('checks GitHub authentication', async () => {
    await command.execute('42');

    expect(mockGuard.requireGhAuth).toHaveBeenCalled();
  });

  it('copies the formatted issue to the clipboard', async () => {
    await command.execute('42');

    expect(mockGitHub.viewIssue).toHaveBeenCalledWith(42);
    expect(copyToClipboard).toHaveBeenCalledWith(
      '# cli: add clipboard support (#42)\n\n## Problem\n\nStuff is hard to copy.\n'
    );
    expect(mockLogger.success).toHaveBeenCalledWith(expect.stringContaining('Issue #42 copied to clipboard'));
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('handles an issue with no body', async () => {
    vi.mocked(mockGitHub.viewIssue).mockResolvedValue({ ...issue, body: undefined });

    await command.execute('42');

    expect(copyToClipboard).toHaveBeenCalledWith(
      '# cli: add clipboard support (#42)\n\n(no body)\n'
    );
  });

  it('rejects a non-numeric issue argument', async () => {
    await command.execute('abc');

    expect(mockLogger.error).toHaveBeenCalledWith('Invalid issue number: abc');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockGitHub.viewIssue).not.toHaveBeenCalled();
  });

  it('exits when the issue cannot be fetched', async () => {
    vi.mocked(mockGitHub.viewIssue).mockRejectedValue(new Error('not found'));

    await command.execute('999');

    expect(mockLogger.error).toHaveBeenCalledWith('Cannot fetch issue #999: not found');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(copyToClipboard).not.toHaveBeenCalled();
  });

  describe('with no issue argument', () => {
    it('lists open issues and grabs the picked one', async () => {
      vi.spyOn(command as any, 'promptLine').mockResolvedValue('42');

      await command.execute();

      expect(mockGitHub.listOpenIssues).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith('  #42  cli: add clipboard support  [cli]');
      expect(consoleLogSpy).toHaveBeenCalledWith('  #43  api: fix rate limiting');
      expect(mockGitHub.viewIssue).toHaveBeenCalledWith(42);
      expect(copyToClipboard).toHaveBeenCalled();
    });

    it('aborts when the user enters nothing', async () => {
      vi.spyOn(command as any, 'promptLine').mockResolvedValue('');

      await command.execute();

      expect(mockLogger.warn).toHaveBeenCalledWith('No issue selected. Aborting.');
      expect(mockGitHub.viewIssue).not.toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('reports when there are no open issues', async () => {
      vi.mocked(mockGitHub.listOpenIssues).mockResolvedValue([]);

      await command.execute();

      expect(mockLogger.info).toHaveBeenCalledWith('No open issues found.');
      expect(mockGitHub.viewIssue).not.toHaveBeenCalled();
    });

    it('exits when listing issues fails', async () => {
      vi.mocked(mockGitHub.listOpenIssues).mockRejectedValue(new Error('gh failed'));

      await command.execute();

      expect(mockLogger.error).toHaveBeenCalledWith('Cannot list issues: gh failed');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('rejects a non-numeric picked value', async () => {
      vi.spyOn(command as any, 'promptLine').mockResolvedValue('abc');

      await command.execute();

      expect(mockLogger.error).toHaveBeenCalledWith('Invalid issue number: abc');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  it('prints the issue when the clipboard is unavailable', async () => {
    vi.mocked(copyToClipboard).mockRejectedValue(new Error("Clipboard command 'pbcopy' failed"));

    await command.execute('42');

    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Clipboard unavailable'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('# cli: add clipboard support (#42)'));
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
