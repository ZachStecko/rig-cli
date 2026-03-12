import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CreateIssueCommand } from '../../src/commands/create-issue.command.js';
import { Logger } from '../../src/services/logger.service.js';
import { ConfigManager } from '../../src/services/config-manager.service.js';
import { StateManager } from '../../src/services/state-manager.service.js';
import { GitService } from '../../src/services/git.service.js';
import { GitHubService } from '../../src/services/github.service.js';
import { GuardService } from '../../src/services/guard.service.js';
import { LLMService } from '../../src/services/llm.service.js';
import * as readline from 'readline';

// Mock readline module
vi.mock('readline', () => ({
  createInterface: vi.fn(),
}));

describe('CreateIssueCommand', () => {
  let command: CreateIssueCommand;
  let mockLogger: Logger;
  let mockConfig: ConfigManager;
  let mockState: StateManager;
  let mockGit: GitService;
  let mockGitHub: GitHubService;
  let mockGuard: GuardService;
  let consoleLogSpy: any;
  let mockLLMService: any;

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
      createIssue: vi.fn(),
      repoName: vi.fn(),
    } as any;

    mockGuard = {
      requireGhAuth: vi.fn(),
    } as any;

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Mock LLMService prototype methods
    mockLLMService = {
      isInstalled: vi.fn(),
      structureIssue: vi.fn(),
    };

    // Replace LLMService prototype methods with mocks
    vi.spyOn(LLMService.prototype, 'isInstalled').mockImplementation(mockLLMService.isInstalled);
    vi.spyOn(LLMService.prototype, 'structureIssue').mockImplementation(mockLLMService.structureIssue);

    command = new CreateIssueCommand(
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
    vi.restoreAllMocks();
  });

  describe('execute', () => {
    it('checks GitHub authentication before proceeding', async () => {
      // Mock empty description input to exit early
      const mockRL = {
        on: vi.fn((event, callback) => {
          if (event === 'close') {
            // Simulate Ctrl+D with empty input
            callback();
          }
          return mockRL;
        }),
        close: vi.fn(),
        question: vi.fn(),
      };
      vi.mocked(readline.createInterface).mockReturnValue(mockRL as any);
      vi.spyOn(process, 'once').mockImplementation(() => process as any);

      await command.execute();

      expect(mockGuard.requireGhAuth).toHaveBeenCalled();
    });

    it('displays header and prompt', async () => {
      const mockRL = {
        on: vi.fn((event, callback) => {
          if (event === 'close') {
            callback();
          }
          return mockRL;
        }),
        close: vi.fn(),
        question: vi.fn(),
      };
      vi.mocked(readline.createInterface).mockReturnValue(mockRL as any);
      vi.spyOn(process, 'once').mockImplementation(() => process as any);

      await command.execute();

      expect(mockLogger.header).toHaveBeenCalledWith('Create GitHub Issue');
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Describe the issue'));
    });

    it('warns and exits when description is empty', async () => {
      const mockRL = {
        on: vi.fn((event, callback) => {
          if (event === 'close') {
            callback();
          }
          return mockRL;
        }),
        close: vi.fn(),
        question: vi.fn(),
      };
      vi.mocked(readline.createInterface).mockReturnValue(mockRL as any);
      vi.spyOn(process, 'once').mockImplementation(() => process as any);

      await command.execute();

      expect(mockLogger.warn).toHaveBeenCalledWith('No description provided. Aborting.');
    });

    it('checks if LLM service is installed', async () => {
      const mockDescription = 'Add authentication feature';
      const mockRL = {
        on: vi.fn((event, callback) => {
          if (event === 'line') {
            callback(mockDescription);
          }
          if (event === 'close') {
            callback();
          }
          return mockRL;
        }),
        close: vi.fn(),
        question: vi.fn(),
      };
      vi.mocked(readline.createInterface).mockReturnValue(mockRL as any);
      vi.spyOn(process, 'once').mockImplementation(() => process as any);
      vi.spyOn(process, 'removeListener').mockImplementation(() => process as any);
      mockLLMService.isInstalled.mockResolvedValue(false);

      await command.execute();

      expect(mockLLMService.isInstalled).toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith('Claude CLI is not installed. Install it with:');
    });

    it('successfully creates an issue with structured content', async () => {
      const mockDescription = 'Add user authentication with OAuth';
      const mockStructured = {
        title: 'Add user authentication',
        body: 'Implement OAuth authentication for users.',
      };
      const mockIssueNumber = 42;
      const mockRepoName = 'owner/repo';

      // Mock multiline input
      const mockRL = {
        on: vi.fn((event, callback) => {
          if (event === 'line') {
            callback(mockDescription);
          }
          if (event === 'close') {
            callback();
          }
          return mockRL;
        }),
        close: vi.fn(),
        question: vi.fn((question, answerCallback) => {
          // Auto-confirm
          answerCallback('y');
        }),
      };
      vi.mocked(readline.createInterface).mockReturnValue(mockRL as any);
      vi.spyOn(process, 'once').mockImplementation(() => process as any);
      vi.spyOn(process, 'removeListener').mockImplementation(() => process as any);

      mockLLMService.isInstalled.mockResolvedValue(true);
      mockLLMService.structureIssue.mockResolvedValue(mockStructured);
      vi.mocked(mockGitHub.createIssue).mockResolvedValue(mockIssueNumber);
      vi.mocked(mockGitHub.repoName).mockResolvedValue(mockRepoName);

      await command.execute();

      expect(mockLLMService.structureIssue).toHaveBeenCalledWith(mockDescription);
      expect(mockGitHub.createIssue).toHaveBeenCalledWith({
        title: mockStructured.title,
        body: mockStructured.body,
      });
      expect(mockLogger.success).toHaveBeenCalledWith(`Issue #${mockIssueNumber} created successfully!`);
      expect(consoleLogSpy).toHaveBeenCalledWith(`  https://github.com/${mockRepoName}/issues/${mockIssueNumber}`);
    });

    it('cancels issue creation when user declines confirmation', async () => {
      const mockDescription = 'Add authentication';
      const mockStructured = {
        title: 'Add user authentication',
        body: 'Implement OAuth authentication.',
      };

      const mockRL = {
        on: vi.fn((event, callback) => {
          if (event === 'line') {
            callback(mockDescription);
          }
          if (event === 'close') {
            callback();
          }
          return mockRL;
        }),
        close: vi.fn(),
        question: vi.fn((question, answerCallback) => {
          // Decline confirmation
          answerCallback('n');
        }),
      };
      vi.mocked(readline.createInterface).mockReturnValue(mockRL as any);
      vi.spyOn(process, 'once').mockImplementation(() => process as any);
      vi.spyOn(process, 'removeListener').mockImplementation(() => process as any);

      mockLLMService.isInstalled.mockResolvedValue(true);
      mockLLMService.structureIssue.mockResolvedValue(mockStructured);

      await command.execute();

      expect(mockGitHub.createIssue).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith('Issue creation cancelled.');
    });

    it('handles LLM structuring errors gracefully', async () => {
      const mockDescription = 'Add authentication';
      const mockError = new Error('LLM API error');

      const mockRL = {
        on: vi.fn((event, callback) => {
          if (event === 'line') {
            callback(mockDescription);
          }
          if (event === 'close') {
            callback();
          }
          return mockRL;
        }),
        close: vi.fn(),
        question: vi.fn(),
      };
      vi.mocked(readline.createInterface).mockReturnValue(mockRL as any);
      vi.spyOn(process, 'once').mockImplementation(() => process as any);
      vi.spyOn(process, 'removeListener').mockImplementation(() => process as any);

      mockLLMService.isInstalled.mockResolvedValue(true);
      mockLLMService.structureIssue.mockRejectedValue(mockError);

      await command.execute();

      expect(mockLogger.error).toHaveBeenCalledWith(`Failed to structure issue: ${mockError.message}`);
      expect(mockGitHub.createIssue).not.toHaveBeenCalled();
    });

    it('handles GitHub issue creation errors gracefully', async () => {
      const mockDescription = 'Add authentication';
      const mockStructured = {
        title: 'Add user authentication',
        body: 'Implement OAuth authentication.',
      };
      const mockError = new Error('GitHub API error');

      const mockRL = {
        on: vi.fn((event, callback) => {
          if (event === 'line') {
            callback(mockDescription);
          }
          if (event === 'close') {
            callback();
          }
          return mockRL;
        }),
        close: vi.fn(),
        question: vi.fn((question, answerCallback) => {
          answerCallback('y');
        }),
      };
      vi.mocked(readline.createInterface).mockReturnValue(mockRL as any);
      vi.spyOn(process, 'once').mockImplementation(() => process as any);
      vi.spyOn(process, 'removeListener').mockImplementation(() => process as any);

      mockLLMService.isInstalled.mockResolvedValue(true);
      mockLLMService.structureIssue.mockResolvedValue(mockStructured);
      vi.mocked(mockGitHub.createIssue).mockRejectedValue(mockError);

      await command.execute();

      expect(mockLogger.error).toHaveBeenCalledWith(`Failed to create issue: ${mockError.message}`);
    });
  });
});
