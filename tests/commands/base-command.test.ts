import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseCommand } from '../../src/commands/base-command.js';
import { Logger } from '../../src/services/logger.service.js';
import { ConfigManager } from '../../src/services/config-manager.service.js';
import { StateManager } from '../../src/services/state-manager.service.js';
import { GitService } from '../../src/services/git.service.js';
import { GitHubService } from '../../src/services/github.service.js';
import { GuardService } from '../../src/services/guard.service.js';

/**
 * TestCommand is a concrete implementation of BaseCommand for testing.
 */
class TestCommand extends BaseCommand {
  public executeCallCount = 0;
  public executeArgs: any[] = [];

  async execute(...args: any[]): Promise<void> {
    this.executeCallCount++;
    this.executeArgs = args;
  }

  // Expose protected methods for testing
  public getProjectRoot(): string {
    return this.projectRoot;
  }

  public getLogger(): Logger {
    return this.logger;
  }

  public getConfig(): ConfigManager {
    return this.config;
  }

  public getState(): StateManager {
    return this.state;
  }

  public getGit(): GitService {
    return this.git;
  }

  public getGitHub(): GitHubService {
    return this.github;
  }

  public getGuard(): GuardService {
    return this.guard;
  }

  public testResolveProjectRoot(path?: string): string {
    return this.resolveProjectRoot(path);
  }
}

describe('BaseCommand', () => {
  let mockLogger: Logger;
  let mockConfig: ConfigManager;
  let mockState: StateManager;
  let mockGit: GitService;
  let mockGitHub: GitHubService;
  let mockGuard: GuardService;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      success: vi.fn(),
    } as any;

    mockConfig = {
      load: vi.fn(),
      get: vi.fn(),
    } as any;

    mockState = {
      load: vi.fn(),
      save: vi.fn(),
    } as any;

    mockGit = {
      currentBranch: vi.fn(),
      status: vi.fn(),
    } as any;

    mockGitHub = {
      viewIssue: vi.fn(),
      createPullRequest: vi.fn(),
    } as any;

    mockGuard = {
      checkGitRepository: vi.fn(),
      checkGitHubAuth: vi.fn(),
    } as any;
  });

  describe('constructor', () => {
    it('wires up all services', () => {
      const command = new TestCommand(
        mockLogger,
        mockConfig,
        mockState,
        mockGit,
        mockGitHub,
        mockGuard
      );

      expect(command.getLogger()).toBe(mockLogger);
      expect(command.getConfig()).toBe(mockConfig);
      expect(command.getState()).toBe(mockState);
      expect(command.getGit()).toBe(mockGit);
      expect(command.getGitHub()).toBe(mockGitHub);
      expect(command.getGuard()).toBe(mockGuard);
    });

    it('defaults project root to process.cwd() when not provided', () => {
      const command = new TestCommand(
        mockLogger,
        mockConfig,
        mockState,
        mockGit,
        mockGitHub,
        mockGuard
      );

      expect(command.getProjectRoot()).toBe(process.cwd());
    });

    it('uses provided project root when given', () => {
      const customRoot = '/custom/project/root';
      const command = new TestCommand(
        mockLogger,
        mockConfig,
        mockState,
        mockGit,
        mockGitHub,
        mockGuard,
        customRoot
      );

      expect(command.getProjectRoot()).toBe(customRoot);
    });
  });

  describe('execute', () => {
    it('is abstract and must be implemented by subclasses', async () => {
      const command = new TestCommand(
        mockLogger,
        mockConfig,
        mockState,
        mockGit,
        mockGitHub,
        mockGuard
      );

      await command.execute('arg1', 'arg2');

      expect(command.executeCallCount).toBe(1);
      expect(command.executeArgs).toEqual(['arg1', 'arg2']);
    });

    it('can be called multiple times', async () => {
      const command = new TestCommand(
        mockLogger,
        mockConfig,
        mockState,
        mockGit,
        mockGitHub,
        mockGuard
      );

      await command.execute('first');
      await command.execute('second');
      await command.execute('third');

      expect(command.executeCallCount).toBe(3);
      expect(command.executeArgs).toEqual(['third']); // Last call
    });

    it('can handle no arguments', async () => {
      const command = new TestCommand(
        mockLogger,
        mockConfig,
        mockState,
        mockGit,
        mockGitHub,
        mockGuard
      );

      await command.execute();

      expect(command.executeCallCount).toBe(1);
      expect(command.executeArgs).toEqual([]);
    });
  });

  describe('resolveProjectRoot', () => {
    it('returns provided path when given', () => {
      const command = new TestCommand(
        mockLogger,
        mockConfig,
        mockState,
        mockGit,
        mockGitHub,
        mockGuard
      );

      const customPath = '/test/custom/path';
      expect(command.testResolveProjectRoot(customPath)).toBe(customPath);
    });

    it('returns process.cwd() when no path provided', () => {
      const command = new TestCommand(
        mockLogger,
        mockConfig,
        mockState,
        mockGit,
        mockGitHub,
        mockGuard
      );

      expect(command.testResolveProjectRoot()).toBe(process.cwd());
    });

    it('returns process.cwd() when undefined provided', () => {
      const command = new TestCommand(
        mockLogger,
        mockConfig,
        mockState,
        mockGit,
        mockGitHub,
        mockGuard
      );

      expect(command.testResolveProjectRoot(undefined)).toBe(process.cwd());
    });

    it('handles empty string as valid path', () => {
      const command = new TestCommand(
        mockLogger,
        mockConfig,
        mockState,
        mockGit,
        mockGitHub,
        mockGuard
      );

      // Empty string is falsy, so should default to process.cwd()
      expect(command.testResolveProjectRoot('')).toBe(process.cwd());
    });
  });

  describe('service access', () => {
    it('allows subclasses to access logger', async () => {
      const command = new TestCommand(
        mockLogger,
        mockConfig,
        mockState,
        mockGit,
        mockGitHub,
        mockGuard
      );

      command.getLogger().info('test message');

      expect(mockLogger.info).toHaveBeenCalledWith('test message');
    });

    it('allows subclasses to access config', () => {
      const command = new TestCommand(
        mockLogger,
        mockConfig,
        mockState,
        mockGit,
        mockGitHub,
        mockGuard
      );

      command.getConfig().get();

      expect(mockConfig.get).toHaveBeenCalled();
    });

    it('allows subclasses to access state', () => {
      const command = new TestCommand(
        mockLogger,
        mockConfig,
        mockState,
        mockGit,
        mockGitHub,
        mockGuard
      );

      command.getState().load();

      expect(mockState.load).toHaveBeenCalled();
    });

    it('allows subclasses to access git service', () => {
      const command = new TestCommand(
        mockLogger,
        mockConfig,
        mockState,
        mockGit,
        mockGitHub,
        mockGuard
      );

      command.getGit().currentBranch();

      expect(mockGit.currentBranch).toHaveBeenCalled();
    });

    it('allows subclasses to access github service', () => {
      const command = new TestCommand(
        mockLogger,
        mockConfig,
        mockState,
        mockGit,
        mockGitHub,
        mockGuard
      );

      command.getGitHub().viewIssue(42);

      expect(mockGitHub.viewIssue).toHaveBeenCalledWith(42);
    });

    it('allows subclasses to access guard service', () => {
      const command = new TestCommand(
        mockLogger,
        mockConfig,
        mockState,
        mockGit,
        mockGitHub,
        mockGuard
      );

      command.getGuard().checkGitRepository();

      expect(mockGuard.checkGitRepository).toHaveBeenCalled();
    });
  });

  describe('real-world usage patterns', () => {
    it('can instantiate with all real services', () => {
      // This test just ensures the constructor signature works
      // with all required services
      const command = new TestCommand(
        mockLogger,
        mockConfig,
        mockState,
        mockGit,
        mockGitHub,
        mockGuard,
        '/test/project'
      );

      expect(command).toBeInstanceOf(BaseCommand);
      expect(command).toBeInstanceOf(TestCommand);
    });

    it('can be used in async/await patterns', async () => {
      const command = new TestCommand(
        mockLogger,
        mockConfig,
        mockState,
        mockGit,
        mockGitHub,
        mockGuard
      );

      // Should not throw
      await expect(command.execute('test')).resolves.toBeUndefined();
    });
  });
});
