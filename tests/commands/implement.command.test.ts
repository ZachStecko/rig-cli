import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ImplementCommand } from '../../src/commands/implement.command.js';
import { Logger } from '../../src/services/logger.service.js';
import { ConfigManager } from '../../src/services/config-manager.service.js';
import { StateManager } from '../../src/services/state-manager.service.js';
import { GitService } from '../../src/services/git.service.js';
import { GitHubService } from '../../src/services/github.service.js';
import { GuardService } from '../../src/services/guard.service.js';
import { RigConfig } from '../../src/types/config.types.js';
import { EventEmitter } from 'events';

// Helper to create proper RigConfig mock
const createMockRigConfig = (overrides?: Partial<RigConfig>): RigConfig => ({
  agent: { max_turns: 20 },
  queue: { default_phase: null, default_component: null },
  test: { require_new_tests: true },
  demo: { enabled: false },
  pr: { draft: false, reviewers: [] },
  ...overrides,
});

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
  assemblePrompt: vi.fn(),
  detectComponent: vi.fn(),
  buildAllowedTools: vi.fn(),
};

vi.mock('../../src/services/prompt-builder.service.js', () => ({
  PromptBuilderService: vi.fn(() => mockPromptBuilder),
}));

describe('ImplementCommand', () => {
  let command: ImplementCommand;
  let mockLogger: Logger;
  let mockConfig: ConfigManager;
  let mockState: StateManager;
  let mockGit: GitService;
  let mockGitHub: GitHubService;
  let mockGuard: GuardService;
  let consoleLogSpy: any;
  let exitSpy: any;
  let mockChildProcess: any;

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
      get: vi.fn().mockReturnValue(createMockRigConfig()),
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
      viewIssue: vi.fn(),
    } as any;

    mockGuard = {
      requireGhAuth: vi.fn().mockResolvedValue(undefined),
    } as any;

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

    // Mock child process
    mockChildProcess = new EventEmitter() as any;
    mockChildProcess.stdout = new EventEmitter();
    mockChildProcess.stderr = new EventEmitter();
    mockChildProcess.exitCode = 0;

    // Reset all mocks
    vi.clearAllMocks();

    command = new ImplementCommand(
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

    it('exits with error when Claude CLI is not installed', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user authentication',
        branch: 'issue-42-add-user-authentication',
        stage: 'pick' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'pending' as const,
          implement: 'pending' as const,
          test: 'pending' as const,
          demo: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });
      vi.mocked(mockClaude.isInstalled).mockResolvedValue(false);

      await command.execute();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Claude CLI is not installed. Install it first: npm install -g @anthropics/claude-cli'
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('displays header with issue info', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user authentication',
        branch: 'issue-42-add-user-authentication',
        stage: 'pick' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'pending' as const,
          implement: 'pending' as const,
          test: 'pending' as const,
          demo: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });
      vi.mocked(mockClaude.isInstalled).mockResolvedValue(true);
      vi.mocked(mockClaude.run).mockResolvedValue(mockChildProcess);
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 42,
        title: 'Add user authentication',
        labels: [{ name: 'backend' }],
      });
      vi.mocked(mockPromptBuilder.assemblePrompt).mockResolvedValue('Test prompt');
      vi.mocked(mockPromptBuilder.detectComponent).mockReturnValue('backend');
      vi.mocked(mockPromptBuilder.buildAllowedTools).mockReturnValue('Read,Write,Bash');

      // Simulate process completion
      setTimeout(() => {
        mockChildProcess.emit('close', 0);
      }, 10);

      await command.execute();

      expect(mockLogger.header).toHaveBeenCalledWith('Implementing Issue #42');
      expect(mockLogger.info).toHaveBeenCalledWith('Issue: Add user authentication');
      expect(mockLogger.info).toHaveBeenCalledWith('Branch: issue-42-add-user-authentication');
    });

    it('updates state to in_progress before running Claude', async () => {
      const initialState = {
        issue_number: 42,
        issue_title: 'Add user authentication',
        branch: 'issue-42-add-user-authentication',
        stage: 'pick' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'pending' as const,
          implement: 'pending' as const,
          test: 'pending' as const,
          demo: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      };

      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({ ...initialState });
      vi.mocked(mockClaude.isInstalled).mockResolvedValue(true);
      vi.mocked(mockClaude.run).mockResolvedValue(mockChildProcess);
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 42,
        title: 'Add user authentication',
        labels: [{ name: 'backend' }],
      });
      vi.mocked(mockPromptBuilder.assemblePrompt).mockResolvedValue('Test prompt');
      vi.mocked(mockPromptBuilder.detectComponent).mockReturnValue('backend');
      vi.mocked(mockPromptBuilder.buildAllowedTools).mockReturnValue('Read,Write,Bash');

      // Simulate process completion
      setTimeout(() => {
        mockChildProcess.emit('close', 0);
      }, 10);

      await command.execute();

      // Check that state was written twice
      expect(mockState.write).toHaveBeenCalledTimes(2);

      // Check first write call (should mark implement as in_progress)
      const firstCall = vi.mocked(mockState.write).mock.calls[0][0];
      expect(firstCall.stage).toBe('implement');
      expect(firstCall.stages.implement).toBe('in_progress');
    });

    it('assembles prompt with issue number', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user authentication',
        branch: 'issue-42-add-user-authentication',
        stage: 'pick' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'pending' as const,
          implement: 'pending' as const,
          test: 'pending' as const,
          demo: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });
      vi.mocked(mockClaude.isInstalled).mockResolvedValue(true);
      vi.mocked(mockClaude.run).mockResolvedValue(mockChildProcess);
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 42,
        title: 'Add user authentication',
        labels: [{ name: 'backend' }],
      });
      vi.mocked(mockPromptBuilder.assemblePrompt).mockResolvedValue('Test prompt');
      vi.mocked(mockPromptBuilder.detectComponent).mockReturnValue('backend');
      vi.mocked(mockPromptBuilder.buildAllowedTools).mockReturnValue('Read,Write,Bash');

      // Simulate process completion
      setTimeout(() => {
        mockChildProcess.emit('close', 0);
      }, 10);

      await command.execute();

      expect(mockPromptBuilder.assemblePrompt).toHaveBeenCalledWith(42);
    });

    it('detects component from issue labels', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user authentication',
        branch: 'issue-42-add-user-authentication',
        stage: 'pick' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'pending' as const,
          implement: 'pending' as const,
          test: 'pending' as const,
          demo: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });
      vi.mocked(mockClaude.isInstalled).mockResolvedValue(true);
      vi.mocked(mockClaude.run).mockResolvedValue(mockChildProcess);
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 42,
        title: 'Add user authentication',
        labels: [{ name: 'frontend' }, { name: 'p0' }],
      });
      vi.mocked(mockPromptBuilder.assemblePrompt).mockResolvedValue('Test prompt');
      vi.mocked(mockPromptBuilder.detectComponent).mockReturnValue('frontend');
      vi.mocked(mockPromptBuilder.buildAllowedTools).mockReturnValue('Read,Write,Bash');

      // Simulate process completion
      setTimeout(() => {
        mockChildProcess.emit('close', 0);
      }, 10);

      await command.execute();

      expect(mockPromptBuilder.detectComponent).toHaveBeenCalledWith(['frontend', 'p0']);
      expect(mockPromptBuilder.buildAllowedTools).toHaveBeenCalledWith('frontend');
    });

    it('runs Claude with correct options', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user authentication',
        branch: 'issue-42-add-user-authentication',
        stage: 'pick' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'pending' as const,
          implement: 'pending' as const,
          test: 'pending' as const,
          demo: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });
      vi.mocked(mockClaude.isInstalled).mockResolvedValue(true);
      vi.mocked(mockClaude.run).mockResolvedValue(mockChildProcess);
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 42,
        title: 'Add user authentication',
        labels: [{ name: 'backend' }],
      });
      vi.mocked(mockPromptBuilder.assemblePrompt).mockResolvedValue('Test prompt here');
      vi.mocked(mockPromptBuilder.detectComponent).mockReturnValue('backend');
      vi.mocked(mockPromptBuilder.buildAllowedTools).mockReturnValue('Read,Write,Bash,Grep');
      vi.mocked(mockConfig.get).mockReturnValue(createMockRigConfig({
        agent: { max_turns: 30 },
      }));

      // Simulate process completion
      setTimeout(() => {
        mockChildProcess.emit('close', 0);
      }, 10);

      await command.execute();

      expect(mockClaude.run).toHaveBeenCalledWith({
        prompt: 'Test prompt here',
        maxTurns: 30,
        allowedTools: 'Read,Write,Bash,Grep',
        logFile: '/test/project/.rig-logs/issue-42.log',
      });
    });

    it('marks implementation as completed on success', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user authentication',
        branch: 'issue-42-add-user-authentication',
        stage: 'implement' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'in_progress' as const,
          test: 'pending' as const,
          demo: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });
      vi.mocked(mockClaude.isInstalled).mockResolvedValue(true);
      vi.mocked(mockClaude.run).mockResolvedValue(mockChildProcess);
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 42,
        title: 'Add user authentication',
        labels: [{ name: 'backend' }],
      });
      vi.mocked(mockPromptBuilder.assemblePrompt).mockResolvedValue('Test prompt');
      vi.mocked(mockPromptBuilder.detectComponent).mockReturnValue('backend');
      vi.mocked(mockPromptBuilder.buildAllowedTools).mockReturnValue('Read,Write,Bash');

      // Simulate successful process completion
      mockChildProcess.exitCode = 0;
      setTimeout(() => {
        mockChildProcess.emit('close', 0);
      }, 10);

      await command.execute();

      // Check second write call (should mark implement as completed)
      expect(mockState.write).toHaveBeenNthCalledWith(2, expect.objectContaining({
        stages: expect.objectContaining({
          implement: 'completed',
        }),
      }));

      expect(mockLogger.success).toHaveBeenCalledWith('Issue #42 implemented');
    });

    it('marks implementation as failed on Claude error', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user authentication',
        branch: 'issue-42-add-user-authentication',
        stage: 'implement' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'in_progress' as const,
          test: 'pending' as const,
          demo: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });
      vi.mocked(mockClaude.isInstalled).mockResolvedValue(true);
      vi.mocked(mockClaude.run).mockResolvedValue(mockChildProcess);
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 42,
        title: 'Add user authentication',
        labels: [{ name: 'backend' }],
      });
      vi.mocked(mockPromptBuilder.assemblePrompt).mockResolvedValue('Test prompt');
      vi.mocked(mockPromptBuilder.detectComponent).mockReturnValue('backend');
      vi.mocked(mockPromptBuilder.buildAllowedTools).mockReturnValue('Read,Write,Bash');

      // Simulate failed process
      mockChildProcess.exitCode = 1;
      setTimeout(() => {
        mockChildProcess.emit('close', 1);
      }, 10);

      await command.execute();

      // Check second write call (should mark implement as failed)
      expect(mockState.write).toHaveBeenNthCalledWith(2, expect.objectContaining({
        stages: expect.objectContaining({
          implement: 'failed',
        }),
      }));

      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Implementation failed'));
      expect(mockLogger.dim).toHaveBeenCalledWith('Check log: /test/project/.rig-logs/issue-42.log');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('streams stdout from Claude process', async () => {
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user authentication',
        branch: 'issue-42-add-user-authentication',
        stage: 'implement' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'in_progress' as const,
          test: 'pending' as const,
          demo: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });
      vi.mocked(mockClaude.isInstalled).mockResolvedValue(true);
      vi.mocked(mockClaude.run).mockResolvedValue(mockChildProcess);
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 42,
        title: 'Add user authentication',
        labels: [{ name: 'backend' }],
      });
      vi.mocked(mockPromptBuilder.assemblePrompt).mockResolvedValue('Test prompt');
      vi.mocked(mockPromptBuilder.detectComponent).mockReturnValue('backend');
      vi.mocked(mockPromptBuilder.buildAllowedTools).mockReturnValue('Read,Write,Bash');

      // Simulate stdout output then completion
      setTimeout(() => {
        mockChildProcess.stdout.emit('data', Buffer.from('Claude output line 1\n'));
        mockChildProcess.stdout.emit('data', Buffer.from('Claude output line 2\n'));
        mockChildProcess.exitCode = 0;
        mockChildProcess.emit('close', 0);
      }, 10);

      await command.execute();

      expect(stdoutSpy).toHaveBeenCalledWith(Buffer.from('Claude output line 1\n'));
      expect(stdoutSpy).toHaveBeenCalledWith(Buffer.from('Claude output line 2\n'));

      stdoutSpy.mockRestore();
    });

    it('displays progress steps during execution', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user authentication',
        branch: 'issue-42-add-user-authentication',
        stage: 'implement' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'in_progress' as const,
          test: 'pending' as const,
          demo: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });
      vi.mocked(mockClaude.isInstalled).mockResolvedValue(true);
      vi.mocked(mockClaude.run).mockResolvedValue(mockChildProcess);
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 42,
        title: 'Add user authentication',
        labels: [{ name: 'backend' }],
      });
      vi.mocked(mockPromptBuilder.assemblePrompt).mockResolvedValue('Test prompt');
      vi.mocked(mockPromptBuilder.detectComponent).mockReturnValue('backend');
      vi.mocked(mockPromptBuilder.buildAllowedTools).mockReturnValue('Read,Write,Bash');

      // Simulate process completion
      setTimeout(() => {
        mockChildProcess.emit('close', 0);
      }, 10);

      await command.execute();

      expect(mockLogger.step).toHaveBeenCalledWith(1, 2, 'Assembling implementation prompt...');
      expect(mockLogger.step).toHaveBeenCalledWith(2, 2, 'Running Claude Code agent...');
    });

    it('checks GitHub authentication before executing', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user authentication',
        branch: 'issue-42-add-user-authentication',
        stage: 'implement' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'pending' as const,
          test: 'pending' as const,
          demo: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });
      vi.mocked(mockClaude.isInstalled).mockResolvedValue(true);
      vi.mocked(mockClaude.run).mockResolvedValue(mockChildProcess);
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 42,
        title: 'Add user authentication',
        labels: [{ name: 'backend' }],
      });
      vi.mocked(mockPromptBuilder.assemblePrompt).mockResolvedValue('Test prompt');
      vi.mocked(mockPromptBuilder.detectComponent).mockReturnValue('backend');
      vi.mocked(mockPromptBuilder.buildAllowedTools).mockReturnValue('Read,Write,Bash');

      setTimeout(() => {
        mockChildProcess.emit('close', 0);
      }, 10);

      await command.execute();

      expect(mockGuard.requireGhAuth).toHaveBeenCalled();
    });
  });

  describe('execute with --issue option', () => {
    it('implements specific issue when --issue is provided', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(false);
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 99,
        title: 'Fix bug in payment flow',
        labels: [{ name: 'backend' }],
      });
      vi.mocked(mockClaude.isInstalled).mockResolvedValue(true);
      vi.mocked(mockClaude.run).mockResolvedValue(mockChildProcess);
      vi.mocked(mockPromptBuilder.assemblePrompt).mockResolvedValue('Test prompt');
      vi.mocked(mockPromptBuilder.detectComponent).mockReturnValue('backend');
      vi.mocked(mockPromptBuilder.buildAllowedTools).mockReturnValue('Read,Write,Bash');

      setTimeout(() => {
        mockChildProcess.emit('close', 0);
      }, 10);

      await command.execute({ issue: '99' });

      expect(mockGitHub.viewIssue).toHaveBeenCalledWith(99);
      expect(mockPromptBuilder.assemblePrompt).toHaveBeenCalledWith(99);
      expect(mockLogger.header).toHaveBeenCalledWith('Implementing Issue #99');
    });

    it('errors on invalid issue number', async () => {
      await command.execute({ issue: 'invalid' });

      expect(mockLogger.error).toHaveBeenCalledWith('Invalid issue number: invalid');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('uses --issue even when state exists', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Old issue',
        branch: 'issue-42',
        stage: 'implement' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'pending' as const,
          test: 'pending' as const,
          demo: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 99,
        title: 'New issue',
        labels: [{ name: 'backend' }],
      });
      vi.mocked(mockClaude.isInstalled).mockResolvedValue(true);
      vi.mocked(mockClaude.run).mockResolvedValue(mockChildProcess);
      vi.mocked(mockPromptBuilder.assemblePrompt).mockResolvedValue('Test prompt');
      vi.mocked(mockPromptBuilder.detectComponent).mockReturnValue('backend');
      vi.mocked(mockPromptBuilder.buildAllowedTools).mockReturnValue('Read,Write,Bash');

      setTimeout(() => {
        mockChildProcess.emit('close', 0);
      }, 10);

      await command.execute({ issue: '99' });

      expect(mockPromptBuilder.assemblePrompt).toHaveBeenCalledWith(99);
      expect(mockLogger.header).toHaveBeenCalledWith('Implementing Issue #99');
    });
  });

  describe('execute with --dry-run option', () => {
    it('shows prompt preview without executing Claude', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user authentication',
        branch: 'issue-42-add-user-authentication',
        stage: 'implement' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'pending' as const,
          test: 'pending' as const,
          demo: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 42,
        title: 'Add user authentication',
        labels: [{ name: 'backend' }],
      });
      vi.mocked(mockPromptBuilder.assemblePrompt).mockResolvedValue('This is a test prompt for implementing the feature');
      vi.mocked(mockPromptBuilder.detectComponent).mockReturnValue('backend');
      vi.mocked(mockPromptBuilder.buildAllowedTools).mockReturnValue('Read,Write,Bash');

      await command.execute({ dryRun: true });

      expect(mockLogger.warn).toHaveBeenCalledWith('[DRY RUN MODE - No changes will be made]');
      expect(mockClaude.isInstalled).not.toHaveBeenCalled();
      expect(mockClaude.run).not.toHaveBeenCalled();
      expect(mockState.write).not.toHaveBeenCalled();
      expect(mockLogger.success).toHaveBeenCalledWith('Dry-run complete. Use without --dry-run to execute.');
    });

    it('displays configuration preview in dry-run mode', async () => {
      vi.mocked(mockState.exists).mockResolvedValue(true);
      vi.mocked(mockState.read).mockResolvedValue({
        issue_number: 42,
        issue_title: 'Add user authentication',
        branch: 'issue-42-add-user-authentication',
        stage: 'implement' as const,
        stages: {
          pick: 'completed' as const,
          branch: 'completed' as const,
          implement: 'pending' as const,
          test: 'pending' as const,
          demo: 'pending' as const,
          pr: 'pending' as const,
          review: 'pending' as const,
        },
      });
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue({
        number: 42,
        title: 'Add user authentication',
        labels: [{ name: 'backend' }],
      });
      vi.mocked(mockPromptBuilder.assemblePrompt).mockResolvedValue('Test prompt');
      vi.mocked(mockPromptBuilder.detectComponent).mockReturnValue('backend');
      vi.mocked(mockPromptBuilder.buildAllowedTools).mockReturnValue('Read,Write,Bash');

      await command.execute({ dryRun: true });

      expect(mockLogger.info).toHaveBeenCalledWith('Prompt preview:');
      expect(mockLogger.info).toHaveBeenCalledWith('Configuration:');
      expect(mockLogger.info).toHaveBeenCalledWith('  Max turns: 20');
      expect(mockLogger.info).toHaveBeenCalledWith('  Allowed tools: Read,Write,Bash');
      expect(mockLogger.info).toHaveBeenCalledWith('  Log file: /test/project/.rig-logs/issue-42.log');
    });
  });
});
