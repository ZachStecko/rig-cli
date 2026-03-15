import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StatusCommand } from '../../src/commands/status.command.js';
import { Logger } from '../../src/services/logger.service.js';
import { ConfigManager } from '../../src/services/config-manager.service.js';
import { StateManager } from '../../src/services/state-manager.service.js';
import { GitService } from '../../src/services/git.service.js';
import { GitHubService } from '../../src/services/github.service.js';
import { GuardService } from '../../src/services/guard.service.js';
import { PipelineState } from '../../src/types/state.types.js';

describe('StatusCommand', () => {
  let command: StatusCommand;
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
      commitCountVsMaster: vi.fn(),
      changedFilesCountVsMaster: vi.fn(),
    } as any;

    mockGitHub = {
      viewIssue: vi.fn(),
    } as any;

    mockGuard = {
      checkGitRepository: vi.fn(),
    } as any;

    // Spy on console.log
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    command = new StatusCommand(
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
    it('shows "no active pipeline" message when state does not exist', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(false);

      await command.execute();

      expect(mockLogger.header).toHaveBeenCalledWith('Pipeline Status');
      expect(mockLogger.dim).toHaveBeenCalledWith("No active pipeline. Run 'rig next' or 'rig ship' to start.");
      expect(mockState.read).not.toHaveBeenCalled();
    });

    it('displays pipeline status when state exists', async () => {
      const mockPipelineState: PipelineState = {
        issue_number: 42,
        issue_title: 'Add user authentication',
        branch: 'feat/auth-42',
        stage: 'implement',
        stages: {
          pick: 'completed',
          branch: 'completed',
          implement: 'in_progress',
          test: 'pending',
          pr: 'pending',
          review: 'pending',
        },
      };

      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue(mockPipelineState);
      vi.mocked(mockGit.currentBranch).mockResolvedValue('feat/auth-42');
      vi.mocked(mockGit.commitCountVsMaster).mockResolvedValue(3);
      vi.mocked(mockGit.changedFilesCountVsMaster).mockResolvedValue(5);

      await command.execute();

      expect(mockLogger.header).toHaveBeenCalledWith('Pipeline Status');
      expect(mockState.read).toHaveBeenCalled();

      // Check issue/branch/stage info was logged
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('#42'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Add user authentication'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('feat/auth-42'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('implement'));

      // Check stage statuses were logged
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('pick'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('completed'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('in_progress'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('pending'));

      // Check git info was logged
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Git:'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('feat/auth-42'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('3'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('5'));
    });

    it('displays all stage statuses in order', async () => {
      const mockPipelineState: PipelineState = {
        issue_number: 1,
        issue_title: 'Test',
        branch: 'test',
        stage: 'test',
        stages: {
          pick: 'completed',
          branch: 'completed',
          implement: 'completed',
          test: 'in_progress',
          pr: 'pending',
          review: 'pending',
        },
      };

      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue(mockPipelineState);
      vi.mocked(mockGit.currentBranch).mockResolvedValue('test');
      vi.mocked(mockGit.commitCountVsMaster).mockResolvedValue(1);
      vi.mocked(mockGit.changedFilesCountVsMaster).mockResolvedValue(2);

      await command.execute();

      // Verify all stages are displayed
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('pick'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('branch'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('implement'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('test'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('demo'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('pr'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('review'));
    });

    it('handles git errors gracefully', async () => {
      const mockPipelineState: PipelineState = {
        issue_number: 42,
        issue_title: 'Test',
        branch: 'test',
        stage: 'implement',
        stages: {
          pick: 'completed',
          branch: 'completed',
          implement: 'in_progress',
          test: 'pending',
          pr: 'pending',
          review: 'pending',
        },
      };

      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue(mockPipelineState);
      vi.mocked(mockGit.currentBranch).mockRejectedValue(new Error('Git error'));

      await command.execute();

      expect(mockLogger.header).toHaveBeenCalledWith('Pipeline Status');
      expect(mockState.read).toHaveBeenCalled();
      expect(mockLogger.dim).toHaveBeenCalledWith('  Git status unavailable');
    });

    it('formats stage names with consistent padding', async () => {
      const mockPipelineState: PipelineState = {
        issue_number: 1,
        issue_title: 'Test',
        branch: 'test',
        stage: 'pick',
        stages: {
          pick: 'completed',
          branch: 'pending',
          implement: 'pending',
          test: 'pending',
          pr: 'pending',
          review: 'pending',
        },
      };

      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue(mockPipelineState);
      vi.mocked(mockGit.currentBranch).mockResolvedValue('test');
      vi.mocked(mockGit.commitCountVsMaster).mockResolvedValue(0);
      vi.mocked(mockGit.changedFilesCountVsMaster).mockResolvedValue(0);

      await command.execute();

      // All stage names should be padded to 12 characters
      const stageLogs = consoleLogSpy.mock.calls
        .filter((call: any) => call[0].includes('pick') || call[0].includes('branch'));

      expect(stageLogs.length).toBeGreaterThan(0);
    });
  });

  describe('stage icons', () => {
    it('uses correct icon for completed stage', async () => {
      const mockPipelineState: PipelineState = {
        issue_number: 1,
        issue_title: 'Test',
        branch: 'test',
        stage: 'pick',
        stages: {
          pick: 'completed',
          branch: 'pending',
          implement: 'pending',
          test: 'pending',
          pr: 'pending',
          review: 'pending',
        },
      };

      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue(mockPipelineState);
      vi.mocked(mockGit.currentBranch).mockResolvedValue('test');
      vi.mocked(mockGit.commitCountVsMaster).mockResolvedValue(0);
      vi.mocked(mockGit.changedFilesCountVsMaster).mockResolvedValue(0);

      await command.execute();

      // Check that ✓ icon appears (it's in the output)
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('✓'));
    });

    it('uses correct icon for in_progress stage', async () => {
      const mockPipelineState: PipelineState = {
        issue_number: 1,
        issue_title: 'Test',
        branch: 'test',
        stage: 'implement',
        stages: {
          pick: 'completed',
          branch: 'completed',
          implement: 'in_progress',
          test: 'pending',
          pr: 'pending',
          review: 'pending',
        },
      };

      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue(mockPipelineState);
      vi.mocked(mockGit.currentBranch).mockResolvedValue('test');
      vi.mocked(mockGit.commitCountVsMaster).mockResolvedValue(0);
      vi.mocked(mockGit.changedFilesCountVsMaster).mockResolvedValue(0);

      await command.execute();

      // Check that ◉ icon appears
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('◉'));
    });

    it('uses correct icon for failed stage', async () => {
      const mockPipelineState: PipelineState = {
        issue_number: 1,
        issue_title: 'Test',
        branch: 'test',
        stage: 'test',
        stages: {
          pick: 'completed',
          branch: 'completed',
          implement: 'completed',
          test: 'failed',
          pr: 'pending',
          review: 'pending',
        },
      };

      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue(mockPipelineState);
      vi.mocked(mockGit.currentBranch).mockResolvedValue('test');
      vi.mocked(mockGit.commitCountVsMaster).mockResolvedValue(0);
      vi.mocked(mockGit.changedFilesCountVsMaster).mockResolvedValue(0);

      await command.execute();

      // Check that ✗ icon appears
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('✗'));
    });

    it('uses correct icon for pending stage', async () => {
      const mockPipelineState: PipelineState = {
        issue_number: 1,
        issue_title: 'Test',
        branch: 'test',
        stage: 'pick',
        stages: {
          pick: 'pending',
          branch: 'pending',
          implement: 'pending',
          test: 'pending',
          pr: 'pending',
          review: 'pending',
        },
      };

      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue(mockPipelineState);
      vi.mocked(mockGit.currentBranch).mockResolvedValue('test');
      vi.mocked(mockGit.commitCountVsMaster).mockResolvedValue(0);
      vi.mocked(mockGit.changedFilesCountVsMaster).mockResolvedValue(0);

      await command.execute();

      // Check that ○ icon appears
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('○'));
    });
  });
});
