import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SetupLabelsCommand } from '../../src/commands/setup-labels.command.js';
import { Logger } from '../../src/services/logger.service.js';
import { ConfigManager } from '../../src/services/config-manager.service.js';
import { StateManager } from '../../src/services/state-manager.service.js';
import { GitService } from '../../src/services/git.service.js';
import { GitHubService } from '../../src/services/github.service.js';
import { GuardService } from '../../src/services/guard.service.js';
import { getLabelDetails } from '../../src/types/labels.types.js';

describe('SetupLabelsCommand', () => {
  let command: SetupLabelsCommand;
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
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      dim: vi.fn(),
      step: vi.fn(),
    } as any;

    mockConfig = {
      load: vi.fn(),
      get: vi.fn().mockReturnValue({}),
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
      syncLabels: vi.fn().mockResolvedValue({ created: ['backend', 'P0'], existing: ['bug'] }),
    } as any;

    mockGuard = {
      requireGhAuth: vi.fn(),
    } as any;

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    command = new SetupLabelsCommand(
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
    vi.clearAllMocks();
  });

  describe('execute', () => {
    it('checks GitHub authentication', async () => {
      await command.execute();

      expect(mockGuard.requireGhAuth).toHaveBeenCalled();
    });

    it('displays header', async () => {
      await command.execute();

      expect(mockLogger.header).toHaveBeenCalledWith('Setting up GitHub labels');
    });

    it('calls syncLabels with all label details', async () => {
      await command.execute();

      const expectedLabels = getLabelDetails();
      expect(mockGitHub.syncLabels).toHaveBeenCalledWith(expectedLabels);
    });

    it('logs created and existing counts', async () => {
      await command.execute();

      expect(mockLogger.success).toHaveBeenCalledWith('Created 2 new labels');
      expect(mockLogger.dim).toHaveBeenCalledWith('Updated 1 existing labels');
    });

    it('shows completion message', async () => {
      await command.execute();

      expect(mockLogger.success).toHaveBeenCalledWith('Label setup complete!');
    });

    it('handles all labels being new', async () => {
      vi.mocked(mockGitHub.syncLabels).mockResolvedValue({ created: ['a', 'b', 'c'], existing: [] });

      await command.execute();

      expect(mockLogger.success).toHaveBeenCalledWith('Created 3 new labels');
      expect(mockLogger.dim).not.toHaveBeenCalledWith(expect.stringContaining('existing'));
    });

    it('handles all labels already existing', async () => {
      vi.mocked(mockGitHub.syncLabels).mockResolvedValue({ created: [], existing: ['a', 'b'] });

      await command.execute();

      expect(mockLogger.dim).toHaveBeenCalledWith('Updated 2 existing labels');
    });

    it('propagates errors from syncLabels', async () => {
      vi.mocked(mockGitHub.syncLabels).mockRejectedValue(new Error('gh auth failed'));

      await expect(command.execute()).rejects.toThrow('gh auth failed');
    });
  });
});
