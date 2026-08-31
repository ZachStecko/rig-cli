import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BranchCommand } from '../../src/commands/branch.command.js';
import { Logger } from '../../src/services/logger.service.js';
import { ConfigManager } from '../../src/services/config-manager.service.js';
import { GitService } from '../../src/services/git.service.js';
import { GitHubService } from '../../src/services/github.service.js';
import { GuardService } from '../../src/services/guard.service.js';

describe('BranchCommand', () => {
  let command: BranchCommand;
  let mockLogger: Logger;
  let mockConfig: ConfigManager;
  let mockGit: GitService;
  let mockGitHub: GitHubService;
  let mockGuard: GuardService;
  let exitSpy: any;

  const issue = {
    number: 21,
    title: 'cli: add clipboard support for issues',
    body: 'body',
    labels: [],
  };

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      dim: vi.fn(),
      spinner: vi.fn((promise: Promise<any>) => promise),
    } as any;

    mockConfig = {
      load: vi.fn(),
      get: vi.fn().mockReturnValue({ git: {}, verbose: false }),
    } as any;

    mockGit = {
      listBranches: vi.fn().mockResolvedValue([]),
      currentBranch: vi.fn().mockResolvedValue('master'),
      checkout: vi.fn(),
      createBranch: vi.fn(),
      getBaseBranchName: vi.fn().mockResolvedValue('master'),
      push: vi.fn(),
    } as any;

    mockGitHub = {
      viewIssue: vi.fn().mockResolvedValue(issue),
    } as any;

    mockGuard = {
      requireGhAuth: vi.fn(),
    } as any;

    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);

    command = new BranchCommand(
      mockLogger,
      mockConfig,
      mockGit,
      mockGitHub,
      mockGuard,
      '/test/project'
    );
  });

  afterEach(() => {
    exitSpy.mockRestore();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('creates a typed branch with the title slug off the base branch', async () => {
    await command.execute('21');

    expect(mockGitHub.viewIssue).toHaveBeenCalledWith(21);
    expect(mockGit.createBranch).toHaveBeenCalledWith('feat/issue-21-add-clipboard-support-for', 'master');
    expect(mockLogger.success).toHaveBeenCalledWith(
      'Created branch feat/issue-21-add-clipboard-support-for off master'
    );
    expect(mockGit.push).toHaveBeenCalled();
    expect(mockLogger.success).toHaveBeenCalledWith(
      'Pushed feat/issue-21-add-clipboard-support-for to origin'
    );
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('warns but does not fail when the push fails', async () => {
    vi.mocked(mockGit.push).mockRejectedValue(new Error('no remote'));

    await command.execute('21');

    expect(mockGit.createBranch).toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('branch exists locally only')
    );
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('uses fix/ for bug-labeled issues', async () => {
    vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
      ...issue,
      labels: [{ name: 'backend' }, { name: 'bug' }],
    });

    await command.execute('21');

    expect(mockGit.createBranch).toHaveBeenCalledWith('fix/issue-21-add-clipboard-support-for', 'master');
  });

  it('switches to an existing issue branch regardless of slug or type', async () => {
    vi.mocked(mockGit.listBranches)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(['fix/issue-21-some-old-slug']);

    await command.execute('21');

    expect(mockGit.listBranches).toHaveBeenCalledWith('issue-21-*');
    expect(mockGit.listBranches).toHaveBeenCalledWith('*/issue-21-*');
    expect(mockGit.checkout).toHaveBeenCalledWith('fix/issue-21-some-old-slug');
    expect(mockGit.createBranch).not.toHaveBeenCalled();
    expect(mockGit.push).not.toHaveBeenCalled();
    expect(mockLogger.success).toHaveBeenCalledWith(
      'Switched to existing branch fix/issue-21-some-old-slug'
    );
  });

  it('does nothing when already on the issue branch', async () => {
    vi.mocked(mockGit.listBranches).mockResolvedValue(['feat/issue-21-some-old-slug']);
    vi.mocked(mockGit.currentBranch).mockResolvedValue('feat/issue-21-some-old-slug');

    await command.execute('21');

    expect(mockGit.checkout).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith('Already on branch feat/issue-21-some-old-slug');
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
  });

  it('exits when branch creation fails', async () => {
    vi.mocked(mockGit.createBranch).mockRejectedValue(new Error('dirty working tree'));

    await command.execute('21');

    expect(mockLogger.error).toHaveBeenCalledWith('Branch creation failed: dirty working tree');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
