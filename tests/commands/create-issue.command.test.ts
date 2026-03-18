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
      config: vi.fn(),
      command: vi.fn(),
      timing: vi.fn(),
      spinner: vi.fn((promise: Promise<any>) => promise),
    } as any;

    mockConfig = {
      load: vi.fn(),
      get: vi.fn().mockReturnValue({ agent: { provider: 'binary' }, verbose: false }),
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
      ensureLabels: vi.fn().mockResolvedValue([]),
    } as any;

    mockGuard = {
      requireGhAuth: vi.fn(),
    } as any;

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Mock LLMService prototype methods
    mockLLMService = {
      isAvailable: vi.fn(),
      structureIssue: vi.fn(),
    };

    // Replace LLMService prototype methods with mocks
    vi.spyOn(LLMService.prototype, 'isAvailable').mockImplementation(mockLLMService.isAvailable);
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

    it('checks if LLM service is available', async () => {
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
      mockLLMService.isAvailable.mockResolvedValue(false);

      await command.execute();

      expect(mockLLMService.isAvailable).toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith('Agent is not available. Check your .rig.yml provider setting and authentication.');
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

      mockLLMService.isAvailable.mockResolvedValue(true);
      mockLLMService.structureIssue.mockResolvedValue(mockStructured);
      vi.mocked(mockGitHub.createIssue).mockResolvedValue(mockIssueNumber);
      vi.mocked(mockGitHub.repoName).mockResolvedValue(mockRepoName);

      await command.execute();

      expect(mockLLMService.structureIssue).toHaveBeenCalledWith(mockDescription);
      expect(mockGitHub.createIssue).toHaveBeenCalledWith({
        title: mockStructured.title,
        body: mockStructured.body,
        labels: undefined,
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

      mockLLMService.isAvailable.mockResolvedValue(true);
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

      mockLLMService.isAvailable.mockResolvedValue(true);
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

      mockLLMService.isAvailable.mockResolvedValue(true);
      mockLLMService.structureIssue.mockResolvedValue(mockStructured);
      vi.mocked(mockGitHub.createIssue).mockRejectedValue(mockError);

      await command.execute();

      expect(mockLogger.error).toHaveBeenCalledWith(`Failed to create issue: ${mockError.message}`);
    });

    it('creates issue with proper code fence formatting', async () => {
      const mockDescription = 'Add authentication with code examples';
      const mockStructured = {
        title: 'feat: Add authentication',
        body: `## Implementation Details

Create an authentication service:

\`\`\`typescript
export class AuthService {
  async login(username: string, password: string) {
    return jwt.sign({ username }, SECRET);
  }
}
\`\`\`

## Testing Strategy
- Test login flow with valid credentials`,
      };
      const mockIssueNumber = 42;
      const mockRepoName = 'owner/repo';

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

      mockLLMService.isAvailable.mockResolvedValue(true);
      mockLLMService.structureIssue.mockResolvedValue(mockStructured);
      vi.mocked(mockGitHub.createIssue).mockResolvedValue(mockIssueNumber);
      vi.mocked(mockGitHub.repoName).mockResolvedValue(mockRepoName);

      await command.execute();

      expect(mockGitHub.createIssue).toHaveBeenCalledWith({
        title: mockStructured.title,
        body: mockStructured.body,
        labels: undefined,
      });

      const issueBody = vi.mocked(mockGitHub.createIssue).mock.calls[0][0].body;
      expect(issueBody).toContain('```typescript');
      expect(issueBody).toMatch(/```typescript[\s\S]*?```/);
      expect(issueBody).not.toMatch(/^typescript$/m);
    });

    it('creates issue with default labels when configured', async () => {
      const mockDescription = 'Add authentication feature';
      const mockStructured = {
        title: 'Add user authentication',
        body: 'Implement OAuth authentication for users.',
      };
      const mockIssueNumber = 42;
      const mockRepoName = 'owner/repo';
      const defaultLabels = ['rig-generated', 'enhancement'];

      vi.mocked(mockConfig.get).mockReturnValue({
        agent: { provider: 'binary' },
        verbose: false,
        defaultLabels,
      } as any);

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

      mockLLMService.isAvailable.mockResolvedValue(true);
      mockLLMService.structureIssue.mockResolvedValue(mockStructured);
      vi.mocked(mockGitHub.createIssue).mockResolvedValue(mockIssueNumber);
      vi.mocked(mockGitHub.repoName).mockResolvedValue(mockRepoName);

      await command.execute();

      expect(mockGitHub.createIssue).toHaveBeenCalledWith({
        title: mockStructured.title,
        body: mockStructured.body,
        labels: defaultLabels,
      });
      expect(mockLogger.config).toHaveBeenCalledWith('Default labels', 'rig-generated, enhancement');
    });

    it('creates issue without labels when defaultLabels is empty array', async () => {
      const mockDescription = 'Add authentication feature';
      const mockStructured = {
        title: 'Add user authentication',
        body: 'Implement OAuth authentication for users.',
      };
      const mockIssueNumber = 42;
      const mockRepoName = 'owner/repo';

      vi.mocked(mockConfig.get).mockReturnValue({
        agent: { provider: 'binary' },
        verbose: false,
        defaultLabels: [],
      } as any);

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

      mockLLMService.isAvailable.mockResolvedValue(true);
      mockLLMService.structureIssue.mockResolvedValue(mockStructured);
      vi.mocked(mockGitHub.createIssue).mockResolvedValue(mockIssueNumber);
      vi.mocked(mockGitHub.repoName).mockResolvedValue(mockRepoName);

      await command.execute();

      expect(mockGitHub.createIssue).toHaveBeenCalledWith({
        title: mockStructured.title,
        body: mockStructured.body,
        labels: undefined,
      });
      expect(mockLogger.config).not.toHaveBeenCalledWith('Default labels', expect.anything());
    });

    it('creates issue without labels when defaultLabels is undefined', async () => {
      const mockDescription = 'Add authentication feature';
      const mockStructured = {
        title: 'Add user authentication',
        body: 'Implement OAuth authentication for users.',
      };
      const mockIssueNumber = 42;
      const mockRepoName = 'owner/repo';

      vi.mocked(mockConfig.get).mockReturnValue({
        agent: { provider: 'binary' },
        verbose: false,
      } as any);

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

      mockLLMService.isAvailable.mockResolvedValue(true);
      mockLLMService.structureIssue.mockResolvedValue(mockStructured);
      vi.mocked(mockGitHub.createIssue).mockResolvedValue(mockIssueNumber);
      vi.mocked(mockGitHub.repoName).mockResolvedValue(mockRepoName);

      await command.execute();

      expect(mockGitHub.createIssue).toHaveBeenCalledWith({
        title: mockStructured.title,
        body: mockStructured.body,
        labels: undefined,
      });
      expect(mockLogger.config).not.toHaveBeenCalledWith('Default labels', expect.anything());
    });

    it('rejects invalid labels and provides helpful error message', async () => {
      const invalidLabels = ['invalid-label', 'foo', 'bar'];

      vi.mocked(mockConfig.get).mockReturnValue({
        agent: { provider: 'binary' },
        verbose: false,
        defaultLabels: invalidLabels,
      } as any);

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

      expect(mockLogger.error).toHaveBeenCalledWith('Invalid labels in config: invalid-label, foo, bar');
      expect(mockLogger.info).toHaveBeenCalledWith('Valid labels are defined in src/types/labels.types.ts');
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Examples:'));
      expect(mockGitHub.createIssue).not.toHaveBeenCalled();
    });

    it('accepts all valid labels from the defined set', async () => {
      const mockDescription = 'Add authentication feature';
      const mockStructured = {
        title: 'Add user authentication',
        body: 'Implement OAuth authentication for users.',
      };
      const mockIssueNumber = 42;
      const mockRepoName = 'owner/repo';
      const validLabels = ['backend', 'enhancement', 'P0', 'Phase 1: MVP', 'rig-generated'];

      vi.mocked(mockConfig.get).mockReturnValue({
        agent: { provider: 'binary' },
        verbose: false,
        defaultLabels: validLabels,
      } as any);

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

      mockLLMService.isAvailable.mockResolvedValue(true);
      mockLLMService.structureIssue.mockResolvedValue(mockStructured);
      vi.mocked(mockGitHub.createIssue).mockResolvedValue(mockIssueNumber);
      vi.mocked(mockGitHub.repoName).mockResolvedValue(mockRepoName);

      await command.execute();

      expect(mockGitHub.createIssue).toHaveBeenCalledWith({
        title: mockStructured.title,
        body: mockStructured.body,
        labels: validLabels,
      });
      expect(mockLogger.error).not.toHaveBeenCalledWith(expect.stringContaining('Invalid labels'));
    });

    it('rejects mixed valid and invalid labels', async () => {
      const mixedLabels = ['backend', 'invalid-label', 'enhancement', 'foo'];

      vi.mocked(mockConfig.get).mockReturnValue({
        agent: { provider: 'binary' },
        verbose: false,
        defaultLabels: mixedLabels,
      } as any);

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

      expect(mockLogger.error).toHaveBeenCalledWith('Invalid labels in config: invalid-label, foo');
      expect(mockGitHub.createIssue).not.toHaveBeenCalled();
    });
  });
});
