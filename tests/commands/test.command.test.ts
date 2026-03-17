import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestCommand } from '../../src/commands/test.command.js';
import { Logger } from '../../src/services/logger.service.js';
import { ConfigManager } from '../../src/services/config-manager.service.js';
import { StateManager } from '../../src/services/state-manager.service.js';
import { GitService } from '../../src/services/git.service.js';
import { GitHubService } from '../../src/services/github.service.js';
import { GuardService } from '../../src/services/guard.service.js';

// Mock TestRunnerService
const mockTestRunner = {
  runAllTests: vi.fn(),
  listNewTestFiles: vi.fn(),
};

vi.mock('../../src/services/test-runner.service.js', () => ({
  TestRunnerService: vi.fn(() => mockTestRunner),
}));

// Mock PromptBuilderService
const mockPromptBuilder = {
  detectComponent: vi.fn(),
};

vi.mock('../../src/services/prompt-builder.service.js', () => ({
  PromptBuilderService: vi.fn(() => mockPromptBuilder),
}));

describe('TestCommand', () => {
  let command: TestCommand;
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

    command = new TestCommand(
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
        issue_title: 'Add user authentication',
        branch: 'issue-42-add-user-authentication',
        stage: 'implement' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'completed' as const,
          test: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 42,
        title: 'Add user authentication',
        labels: [{ name: 'backend' }],
      });
      vi.mocked(mockPromptBuilder.detectComponent).mockReturnValue('backend');
      vi.mocked(mockTestRunner.runAllTests).mockResolvedValue({
        success: true,
        output: 'All tests passed',
      });
      vi.mocked(mockTestRunner.listNewTestFiles).mockResolvedValue([]);

      await command.execute();

      expect(mockPromptBuilder.detectComponent).toHaveBeenCalledWith(['backend'], 'Add user authentication', undefined);
      expect(mockTestRunner.runAllTests).toHaveBeenCalledWith('backend');
    });

    it('uses --component option when provided', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user authentication',
        branch: 'issue-42-add-user-authentication',
        stage: 'implement' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'completed' as const,
          test: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 42,
        title: 'Add user authentication',
        labels: [{ name: 'backend' }],
      });
      vi.mocked(mockTestRunner.runAllTests).mockResolvedValue({
        success: true,
        output: '',
      });
      vi.mocked(mockTestRunner.listNewTestFiles).mockResolvedValue([]);

      await command.execute({ component: 'frontend' });

      expect(mockPromptBuilder.detectComponent).not.toHaveBeenCalled();
      expect(mockTestRunner.runAllTests).toHaveBeenCalledWith('frontend');
    });

    it('errors on invalid component option', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user authentication',
        branch: 'issue-42-add-user-authentication',
        stage: 'implement' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'completed' as const,
          test: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });

      await command.execute({ component: 'invalid' });

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Invalid component: invalid. Must be one of: backend, frontend, devnet, fullstack, node'
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('tests node component', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add CLI feature',
        branch: 'issue-42-add-cli-feature',
        stage: 'test' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'completed' as const,
          test: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });
      vi.mocked(mockTestRunner.runAllTests).mockResolvedValue({
        success: true,
        output: '',
      });
      vi.mocked(mockTestRunner.listNewTestFiles).mockResolvedValue([]);

      await command.execute({ component: 'node' });

      expect(mockTestRunner.runAllTests).toHaveBeenCalledWith('node');
      expect(mockLogger.info).toHaveBeenCalledWith('Component: node');
    });

    it('displays header with issue info', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user authentication',
        branch: 'issue-42-add-user-authentication',
        stage: 'implement' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'completed' as const,
          test: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 42,
        title: 'Add user authentication',
        labels: [{ name: 'backend' }],
      });
      vi.mocked(mockPromptBuilder.detectComponent).mockReturnValue('backend');
      vi.mocked(mockTestRunner.runAllTests).mockResolvedValue({
        success: true,
        output: '',
      });
      vi.mocked(mockTestRunner.listNewTestFiles).mockResolvedValue([]);

      await command.execute();

      expect(mockLogger.header).toHaveBeenCalledWith('Testing Issue #42');
      expect(mockLogger.info).toHaveBeenCalledWith('Issue: Add user authentication');
      expect(mockLogger.info).toHaveBeenCalledWith('Component: backend');
    });

    it('updates state to in_progress before running tests', async () => {
      const initialState = {
        issue_number: 42,
        issue_title: 'Add user authentication',
        branch: 'issue-42-add-user-authentication',
        stage: 'implement' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'completed' as const,
          test: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      };

      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({ ...initialState });
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 42,
        title: 'Add user authentication',
        labels: [{ name: 'backend' }],
      });
      vi.mocked(mockPromptBuilder.detectComponent).mockReturnValue('backend');
      vi.mocked(mockTestRunner.runAllTests).mockResolvedValue({
        success: true,
        output: '',
      });
      vi.mocked(mockTestRunner.listNewTestFiles).mockResolvedValue([]);

      await command.execute();

      // Check that state was written twice
      expect(mockState.write).toHaveBeenCalledTimes(2);

      // Check first write call (should mark test as in_progress)
      const firstCall = vi.mocked(mockState.write).mock.calls[0][0];
      expect(firstCall.stage).toBe('test');
      expect(firstCall.stages.test).toBe('in_progress');
    });

    it('marks test as completed on success', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user authentication',
        branch: 'issue-42-add-user-authentication',
        stage: 'test' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'completed' as const,
          test: 'in_progress' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 42,
        title: 'Add user authentication',
        labels: [{ name: 'backend' }],
      });
      vi.mocked(mockPromptBuilder.detectComponent).mockReturnValue('backend');
      vi.mocked(mockTestRunner.runAllTests).mockResolvedValue({
        success: true,
        output: '',
      });
      vi.mocked(mockTestRunner.listNewTestFiles).mockResolvedValue([]);

      await command.execute();

      // Check second write call (should mark test as completed)
      expect(mockState.write).toHaveBeenNthCalledWith(2, expect.objectContaining({
        stages: expect.objectContaining({
          test: 'completed',
        }),
      }));

      expect(mockLogger.success).toHaveBeenCalledWith('Tests passed for issue #42');
    });

    it('marks test as failed on test failure', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user authentication',
        branch: 'issue-42-add-user-authentication',
        stage: 'test' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'completed' as const,
          test: 'in_progress' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 42,
        title: 'Add user authentication',
        labels: [{ name: 'backend' }],
      });
      vi.mocked(mockPromptBuilder.detectComponent).mockReturnValue('backend');
      vi.mocked(mockTestRunner.runAllTests).mockResolvedValue({
        success: false,
        output: 'Test suite failed',
        steps: [{ success: false, output: 'lint errors', step: 'Frontend lint' }],
        failedSteps: [{ success: false, output: 'lint errors', step: 'Frontend lint' }],
      });

      await command.execute();

      // Check second write call (should mark test as failed)
      expect(mockState.write).toHaveBeenNthCalledWith(2, expect.objectContaining({
        stages: expect.objectContaining({
          test: 'failed',
        }),
      }));

      expect(mockLogger.error).toHaveBeenCalledWith('Frontend lint failed:');
      expect(mockLogger.error).toHaveBeenCalledWith('Tests failed: Failed steps: Frontend lint');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('displays test output when available', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user authentication',
        branch: 'issue-42-add-user-authentication',
        stage: 'test' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'completed' as const,
          test: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 42,
        title: 'Add user authentication',
        labels: [{ name: 'backend' }],
      });
      vi.mocked(mockPromptBuilder.detectComponent).mockReturnValue('backend');
      vi.mocked(mockTestRunner.runAllTests).mockResolvedValue({
        success: true,
        output: 'Test output here...',
      });
      vi.mocked(mockTestRunner.listNewTestFiles).mockResolvedValue([]);

      await command.execute();

      expect(consoleLogSpy).toHaveBeenCalledWith('Test output here...');
    });

    it('lists new test files when present', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user authentication',
        branch: 'issue-42-add-user-authentication',
        stage: 'test' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'completed' as const,
          test: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 42,
        title: 'Add user authentication',
        labels: [{ name: 'backend' }],
      });
      vi.mocked(mockPromptBuilder.detectComponent).mockReturnValue('backend');
      vi.mocked(mockTestRunner.runAllTests).mockResolvedValue({
        success: true,
        output: '',
      });
      vi.mocked(mockTestRunner.listNewTestFiles).mockResolvedValue([
        'backend/auth/auth_test.go',
        'backend/auth/jwt_test.go',
      ]);

      await command.execute();

      expect(mockLogger.success).toHaveBeenCalledWith('New test files (2):');
      expect(mockLogger.dim).toHaveBeenCalledWith('  backend/auth/auth_test.go');
      expect(mockLogger.dim).toHaveBeenCalledWith('  backend/auth/jwt_test.go');
    });

    it('handles no new test files case', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user authentication',
        branch: 'issue-42-add-user-authentication',
        stage: 'test' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'completed' as const,
          test: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 42,
        title: 'Add user authentication',
        labels: [{ name: 'backend' }],
      });
      vi.mocked(mockPromptBuilder.detectComponent).mockReturnValue('backend');
      vi.mocked(mockTestRunner.runAllTests).mockResolvedValue({
        success: true,
        output: '',
      });
      vi.mocked(mockTestRunner.listNewTestFiles).mockResolvedValue([]);

      await command.execute();

      expect(mockLogger.info).toHaveBeenCalledWith('No new test files added');
    });

    it('displays progress steps during execution', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user authentication',
        branch: 'issue-42-add-user-authentication',
        stage: 'test' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'completed' as const,
          test: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 42,
        title: 'Add user authentication',
        labels: [{ name: 'backend' }],
      });
      vi.mocked(mockPromptBuilder.detectComponent).mockReturnValue('backend');
      vi.mocked(mockTestRunner.runAllTests).mockResolvedValue({
        success: true,
        output: '',
      });
      vi.mocked(mockTestRunner.listNewTestFiles).mockResolvedValue([]);

      await command.execute();

      expect(mockLogger.step).toHaveBeenCalledWith(1, 2, 'Running backend tests...');
      expect(mockLogger.step).toHaveBeenCalledWith(2, 2, 'Checking new test files...');
    });

    it('tests fullstack component', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user authentication',
        branch: 'issue-42-add-user-authentication',
        stage: 'test' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'completed' as const,
          test: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });
      vi.mocked(mockTestRunner.runAllTests).mockResolvedValue({
        success: true,
        output: '',
      });
      vi.mocked(mockTestRunner.listNewTestFiles).mockResolvedValue([]);

      await command.execute({ component: 'fullstack' });

      expect(mockTestRunner.runAllTests).toHaveBeenCalledWith('fullstack');
      expect(mockLogger.info).toHaveBeenCalledWith('Component: fullstack');
    });
  });
});
