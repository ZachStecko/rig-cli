import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DemoCommand } from '../../src/commands/demo.command.js';
import { Logger } from '../../src/services/logger.service.js';
import { ConfigManager } from '../../src/services/config-manager.service.js';
import { StateManager } from '../../src/services/state-manager.service.js';
import { GitService } from '../../src/services/git.service.js';
import { GitHubService } from '../../src/services/github.service.js';
import { GuardService } from '../../src/services/guard.service.js';

// Mock DemoRecorderService
const mockDemoRecorder = {
  recordDemo: vi.fn(),
};

vi.mock('../../src/services/demo-recorder.service.js', () => ({
  DemoRecorderService: vi.fn(() => mockDemoRecorder),
}));

// Mock PromptBuilderService
const mockPromptBuilder = {
  detectComponent: vi.fn(),
};

vi.mock('../../src/services/prompt-builder.service.js', () => ({
  PromptBuilderService: vi.fn(() => mockPromptBuilder),
}));

describe('DemoCommand', () => {
  let command: DemoCommand;
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
      get: vi.fn(),
    } as any;

    mockState = {
      exists: vi.fn(),
      read: vi.fn(),
      write: vi.fn(),
    } as any;

    mockGit = {
      newFilesVsMaster: vi.fn(),
    } as any;

    mockGitHub = {
      viewIssue: vi.fn(),
    } as any;

    mockGuard = {
      requireGhAuth: vi.fn(),
    } as any;

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

    // Reset all mocks
    vi.clearAllMocks();

    command = new DemoCommand(
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
    it('exits with error when no state exists', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(false);

      await command.execute();

      expect(mockLogger.error).toHaveBeenCalledWith("No active pipeline. Run 'rig next' to start or use --issue <number>.");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('auto-detects component from issue labels', async () => {
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
          demo: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 42,
        title: 'Add user dashboard',
        labels: [{ name: 'frontend' }],
      });
      vi.mocked(mockPromptBuilder.detectComponent).mockReturnValue('frontend');
      vi.mocked(mockDemoRecorder.recordDemo).mockResolvedValue({
        success: true,
        demoPath: '/test/project/.rig-reviews/issue-42/demo-2024-01-01-120000.gif',
      });

      await command.execute();

      expect(mockPromptBuilder.detectComponent).toHaveBeenCalledWith(['frontend']);
      expect(mockDemoRecorder.recordDemo).toHaveBeenCalledWith(42, 'frontend');
    });

    it('uses --component option when provided', async () => {
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
          demo: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });
      vi.mocked(mockDemoRecorder.recordDemo).mockResolvedValue({
        success: true,
        demoPath: '/test/project/.rig-reviews/issue-42/demo.gif',
      });

      await command.execute({ component: 'backend' });

      expect(mockGitHub.viewIssue).not.toHaveBeenCalled();
      expect(mockPromptBuilder.detectComponent).not.toHaveBeenCalled();
      expect(mockDemoRecorder.recordDemo).toHaveBeenCalledWith(42, 'backend');
    });

    it('errors on invalid component option', async () => {
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
          demo: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });

      await command.execute({ component: 'invalid' });

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Invalid component: invalid. Must be one of: backend, frontend, devnet, fullstack'
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('uses --issue option to record demo for specific issue', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(false);
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 99,
        title: 'Add feature X',
        labels: [{ name: 'backend' }],
      });
      vi.mocked(mockPromptBuilder.detectComponent).mockReturnValue('backend');
      vi.mocked(mockDemoRecorder.recordDemo).mockResolvedValue({
        success: true,
        demoPath: '/test/project/.rig-reviews/issue-99/demo.gif',
      });

      await command.execute({ issue: '99' });

      expect(mockDemoRecorder.recordDemo).toHaveBeenCalledWith(99, 'backend');
    });

    it('errors on invalid issue number', async () => {
      await command.execute({ issue: 'abc' });

      expect(mockLogger.error).toHaveBeenCalledWith('Invalid issue number: abc');
      expect(exitSpy).toHaveBeenCalledWith(1);
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
          demo: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 42,
        title: 'Add user dashboard',
        labels: [{ name: 'frontend' }],
      });
      vi.mocked(mockPromptBuilder.detectComponent).mockReturnValue('frontend');
      vi.mocked(mockDemoRecorder.recordDemo).mockResolvedValue({
        success: true,
      });

      await command.execute();

      expect(mockLogger.header).toHaveBeenCalledWith('Recording Demo for Issue #42');
      expect(mockLogger.info).toHaveBeenCalledWith('Issue: Add user dashboard');
      expect(mockLogger.info).toHaveBeenCalledWith('Component: frontend');
    });

    it('updates state to in_progress before recording', async () => {
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
          demo: 'pending' as const,
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
      vi.mocked(mockPromptBuilder.detectComponent).mockReturnValue('frontend');
      vi.mocked(mockDemoRecorder.recordDemo).mockResolvedValue({
        success: true,
      });

      await command.execute();

      // Check that state was written twice
      expect(mockState.write).toHaveBeenCalledTimes(2);

      // Check first write call (should mark demo as in_progress)
      const firstCall = vi.mocked(mockState.write).mock.calls[0][0];
      expect(firstCall.stage).toBe('demo');
      expect(firstCall.stages.demo).toBe('in_progress');
    });

    it('marks demo as completed on success', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user dashboard',
        branch: 'issue-42-add-user-dashboard',
        stage: 'demo' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'completed' as const,
          test: 'completed' as const,
          demo: 'in_progress' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 42,
        title: 'Add user dashboard',
        labels: [{ name: 'frontend' }],
      });
      vi.mocked(mockPromptBuilder.detectComponent).mockReturnValue('frontend');
      vi.mocked(mockDemoRecorder.recordDemo).mockResolvedValue({
        success: true,
        demoPath: '/test/project/.rig-reviews/issue-42/demo.gif',
      });

      await command.execute();

      // Check second write call (should mark demo as completed)
      expect(mockState.write).toHaveBeenNthCalledWith(2, expect.objectContaining({
        stages: expect.objectContaining({
          demo: 'completed',
        }),
      }));

      expect(mockLogger.success).toHaveBeenCalledWith('Demo recorded for issue #42');
    });

    it('marks demo as failed on recording failure', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user dashboard',
        branch: 'issue-42-add-user-dashboard',
        stage: 'demo' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'completed' as const,
          test: 'completed' as const,
          demo: 'in_progress' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 42,
        title: 'Add user dashboard',
        labels: [{ name: 'frontend' }],
      });
      vi.mocked(mockPromptBuilder.detectComponent).mockReturnValue('frontend');
      vi.mocked(mockDemoRecorder.recordDemo).mockResolvedValue({
        success: false,
      });

      await command.execute();

      // Check second write call (should mark demo as failed)
      expect(mockState.write).toHaveBeenNthCalledWith(2, expect.objectContaining({
        stages: expect.objectContaining({
          demo: 'failed',
        }),
      }));

      expect(mockLogger.error).toHaveBeenCalledWith('Demo recording failed: Demo recording failed');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('displays demo path when available', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user dashboard',
        branch: 'issue-42-add-user-dashboard',
        stage: 'demo' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'completed' as const,
          test: 'completed' as const,
          demo: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 42,
        title: 'Add user dashboard',
        labels: [{ name: 'backend' }],
      });
      vi.mocked(mockPromptBuilder.detectComponent).mockReturnValue('backend');
      vi.mocked(mockDemoRecorder.recordDemo).mockResolvedValue({
        success: true,
        demoPath: '/test/project/.rig-reviews/issue-42/demo-2024-01-01-120000.gif',
      });

      await command.execute();

      expect(mockLogger.dim).toHaveBeenCalledWith('  /test/project/.rig-reviews/issue-42/demo-2024-01-01-120000.gif');
    });

    it('handles skipped demos', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user dashboard',
        branch: 'issue-42-add-user-dashboard',
        stage: 'demo' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'completed' as const,
          test: 'completed' as const,
          demo: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 42,
        title: 'Add user dashboard',
        labels: [{ name: 'devnet' }],
      });
      vi.mocked(mockPromptBuilder.detectComponent).mockReturnValue('devnet');
      vi.mocked(mockDemoRecorder.recordDemo).mockResolvedValue({
        success: true,
        skipped: true,
      });

      await command.execute();

      expect(mockLogger.success).toHaveBeenCalledWith('Demo recording completed (skipped for devnet)');
      expect(mockLogger.dim).toHaveBeenCalledWith('Some demo components were not available or configured.');
    });

    it('displays progress step during execution', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user dashboard',
        branch: 'issue-42-add-user-dashboard',
        stage: 'demo' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'completed' as const,
          test: 'completed' as const,
          demo: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 42,
        title: 'Add user dashboard',
        labels: [{ name: 'fullstack' }],
      });
      vi.mocked(mockPromptBuilder.detectComponent).mockReturnValue('fullstack');
      vi.mocked(mockDemoRecorder.recordDemo).mockResolvedValue({
        success: true,
      });

      await command.execute();

      expect(mockLogger.step).toHaveBeenCalledWith(1, 1, 'Recording fullstack demo...');
    });

    it('tests fullstack component', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user dashboard',
        branch: 'issue-42-add-user-dashboard',
        stage: 'demo' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'completed' as const,
          test: 'completed' as const,
          demo: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });
      vi.mocked(mockDemoRecorder.recordDemo).mockResolvedValue({
        success: true,
      });

      await command.execute({ component: 'fullstack' });

      expect(mockDemoRecorder.recordDemo).toHaveBeenCalledWith(42, 'fullstack');
      expect(mockLogger.info).toHaveBeenCalledWith('Component: fullstack');
    });
  });
});
