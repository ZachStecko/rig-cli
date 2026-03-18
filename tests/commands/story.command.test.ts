import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StoryCommand } from '../../src/commands/story.command.js';
import { Logger } from '../../src/services/logger.service.js';
import { ConfigManager } from '../../src/services/config-manager.service.js';
import { StateManager } from '../../src/services/state-manager.service.js';
import { GitService } from '../../src/services/git.service.js';
import { GitHubService } from '../../src/services/github.service.js';
import { GuardService } from '../../src/services/guard.service.js';
import { LLMService } from '../../src/services/llm.service.js';
import * as readline from 'readline';
import * as fs from 'fs/promises';

// Mock readline module
vi.mock('readline', () => ({
  createInterface: vi.fn(),
}));

// Mock fs/promises
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}));

describe('StoryCommand', () => {
  let command: StoryCommand;
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
      repoName: vi.fn().mockResolvedValue('owner/repo'),
    } as any;

    mockGuard = {
      requireGhAuth: vi.fn(),
    } as any;

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    mockLLMService = {
      isAvailable: vi.fn(),
      structureIssue: vi.fn(),
      decomposeStory: vi.fn(),
    };

    vi.spyOn(LLMService.prototype, 'isAvailable').mockImplementation(mockLLMService.isAvailable);
    vi.spyOn(LLMService.prototype, 'structureIssue').mockImplementation(mockLLMService.structureIssue);
    vi.spyOn(LLMService.prototype, 'decomposeStory').mockImplementation(mockLLMService.decomposeStory);

    command = new StoryCommand(
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

  function mockConfirm(responses: string[]) {
    let callIndex = 0;
    const mockRL = {
      on: vi.fn().mockReturnThis(),
      close: vi.fn(),
      question: vi.fn((question: string, callback: (answer: string) => void) => {
        callback(responses[callIndex++] || 'n');
      }),
    };
    vi.mocked(readline.createInterface).mockReturnValue(mockRL as any);
    vi.spyOn(process, 'once').mockImplementation(() => process as any);
    vi.spyOn(process, 'removeListener').mockImplementation(() => process as any);
    return mockRL;
  }

  describe('execute', () => {
    it('checks GitHub authentication before proceeding', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
      mockConfirm([]);

      await command.execute({ file: 'spec.md' });

      expect(mockGuard.requireGhAuth).toHaveBeenCalled();
    });

    it('errors when spec file cannot be read', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
      mockConfirm([]);

      await command.execute({ file: 'nonexistent.md' });

      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Could not read spec file'));
    });

    it('errors when spec file is empty', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('   ');
      mockConfirm([]);

      await command.execute({ file: 'empty.md' });

      expect(mockLogger.error).toHaveBeenCalledWith('Spec file is empty.');
    });

    it('errors when LLM is not available', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('# My Planning Spec\nSome content');
      mockConfirm([]);
      mockLLMService.isAvailable.mockResolvedValue(false);

      await command.execute({ file: 'spec.md' });

      expect(mockLogger.error).toHaveBeenCalledWith('Agent is not available. Check your .rig.yml provider setting and authentication.');
    });

    it('handles LLM structuring failure gracefully', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('# My Planning Spec');
      mockConfirm([]);
      mockLLMService.isAvailable.mockResolvedValue(true);
      mockLLMService.structureIssue.mockRejectedValue(new Error('LLM API error'));

      await command.execute({ file: 'spec.md' });

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to structure story: LLM API error');
      expect(mockGitHub.createIssue).not.toHaveBeenCalled();
    });

    it('cancels when user declines parent story creation', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('# My Planning Spec\nContent here');
      mockConfirm(['n']);
      mockLLMService.isAvailable.mockResolvedValue(true);
      mockLLMService.structureIssue.mockResolvedValue({
        title: 'cli: Add story decomposition',
        body: 'Decompose planning specs.',
      });

      await command.execute({ file: 'spec.md' });

      expect(mockLogger.warn).toHaveBeenCalledWith('Story creation cancelled.');
      expect(mockGitHub.createIssue).not.toHaveBeenCalled();
    });

    it('creates parent issue with story and rig-created labels', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('# My Planning Spec\nContent here');
      mockConfirm(['y', 'y']);
      mockLLMService.isAvailable.mockResolvedValue(true);
      mockLLMService.structureIssue.mockResolvedValue({
        title: 'cli: Add story decomposition',
        body: 'Decompose planning specs.',
      });
      mockLLMService.decomposeStory.mockResolvedValue([
        { title: 'cli: Add story label', body: 'Parent story: #10\n\nAdd label.', labels: ['backend'] },
      ]);
      vi.mocked(mockGitHub.createIssue)
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(11);

      await command.execute({ file: 'spec.md' });

      const parentCall = vi.mocked(mockGitHub.createIssue).mock.calls[0][0];
      expect(parentCall.labels).toContain('story');
      expect(parentCall.labels).toContain('rig-created');
    });

    it('creates child issues with rig-created label', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('# Spec');
      mockConfirm(['y', 'y']);
      mockLLMService.isAvailable.mockResolvedValue(true);
      mockLLMService.structureIssue.mockResolvedValue({
        title: 'Parent title',
        body: 'Parent body.',
      });
      mockLLMService.decomposeStory.mockResolvedValue([
        { title: 'Child 1', body: 'Parent story: #10\n\nFirst child.', labels: ['backend', 'feature'] },
        { title: 'Child 2', body: 'Parent story: #10\n\nSecond child.', labels: ['frontend', 'enhancement'] },
      ]);
      vi.mocked(mockGitHub.createIssue)
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(11)
        .mockResolvedValueOnce(12);

      await command.execute({ file: 'spec.md' });

      expect(mockGitHub.createIssue).toHaveBeenCalledTimes(3);

      const child1Call = vi.mocked(mockGitHub.createIssue).mock.calls[1][0];
      expect(child1Call.labels).toContain('rig-created');
      expect(child1Call.labels).toContain('backend');
      expect(child1Call.labels).toContain('feature');

      const child2Call = vi.mocked(mockGitHub.createIssue).mock.calls[2][0];
      expect(child2Call.labels).toContain('rig-created');
      expect(child2Call.labels).toContain('frontend');
    });

    it('passes spec content to structureIssue and decomposeStory', async () => {
      const specContent = '# My Feature Spec\n\nDetailed requirements here.';
      vi.mocked(fs.readFile).mockResolvedValue(specContent);
      mockConfirm(['y', 'y']);
      mockLLMService.isAvailable.mockResolvedValue(true);
      mockLLMService.structureIssue.mockResolvedValue({
        title: 'Parent title',
        body: 'Parent body.',
      });
      mockLLMService.decomposeStory.mockResolvedValue([
        { title: 'Child 1', body: 'Parent story: #5\n\nWork.', labels: [] },
      ]);
      vi.mocked(mockGitHub.createIssue)
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(6);

      await command.execute({ file: 'spec.md' });

      expect(mockLLMService.structureIssue).toHaveBeenCalledWith(specContent);
      expect(mockLLMService.decomposeStory).toHaveBeenCalledWith(specContent, 5);
    });

    it('cancels when user declines child issue creation', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('# Spec');
      mockConfirm(['y', 'n']);
      mockLLMService.isAvailable.mockResolvedValue(true);
      mockLLMService.structureIssue.mockResolvedValue({
        title: 'Parent title',
        body: 'Parent body.',
      });
      vi.mocked(mockGitHub.createIssue).mockResolvedValueOnce(10);
      mockLLMService.decomposeStory.mockResolvedValue([
        { title: 'Child 1', body: 'Parent story: #10\n\nWork.', labels: [] },
      ]);

      await command.execute({ file: 'spec.md' });

      expect(mockLogger.warn).toHaveBeenCalledWith('Child issue creation cancelled.');
      // Parent was created but no children
      expect(mockGitHub.createIssue).toHaveBeenCalledTimes(1);
    });

    it('handles decomposition failure gracefully', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('# Spec');
      mockConfirm(['y']);
      mockLLMService.isAvailable.mockResolvedValue(true);
      mockLLMService.structureIssue.mockResolvedValue({
        title: 'Parent title',
        body: 'Parent body.',
      });
      vi.mocked(mockGitHub.createIssue).mockResolvedValueOnce(10);
      mockLLMService.decomposeStory.mockRejectedValue(new Error('Decomposition failed'));

      await command.execute({ file: 'spec.md' });

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to decompose story: Decomposition failed');
    });

    it('handles parent issue creation failure gracefully', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('# Spec');
      mockConfirm(['y']);
      mockLLMService.isAvailable.mockResolvedValue(true);
      mockLLMService.structureIssue.mockResolvedValue({
        title: 'Parent title',
        body: 'Parent body.',
      });
      vi.mocked(mockGitHub.createIssue).mockRejectedValue(new Error('GitHub API error'));

      await command.execute({ file: 'spec.md' });

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to create parent story: GitHub API error');
    });

    it('logs summary with parent and child URLs', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('# Spec');
      mockConfirm(['y', 'y']);
      mockLLMService.isAvailable.mockResolvedValue(true);
      mockLLMService.structureIssue.mockResolvedValue({
        title: 'Parent',
        body: 'Parent body.',
      });
      mockLLMService.decomposeStory.mockResolvedValue([
        { title: 'Child 1', body: 'Parent story: #10\n\nWork.', labels: [] },
        { title: 'Child 2', body: 'Parent story: #10\n\nWork.', labels: [] },
      ]);
      vi.mocked(mockGitHub.createIssue)
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(11)
        .mockResolvedValueOnce(12);
      vi.mocked(mockGitHub.repoName).mockResolvedValue('owner/repo');

      await command.execute({ file: 'spec.md' });

      expect(consoleLogSpy).toHaveBeenCalledWith('  Parent: https://github.com/owner/repo/issues/10');
      expect(consoleLogSpy).toHaveBeenCalledWith('  Child:  https://github.com/owner/repo/issues/11');
      expect(consoleLogSpy).toHaveBeenCalledWith('  Child:  https://github.com/owner/repo/issues/12');
      expect(mockLogger.success).toHaveBeenCalledWith('Created 2 child issues for story #10');
    });

    it('includes default labels from config on parent and child issues', async () => {
      vi.mocked(mockConfig.get).mockReturnValue({
        agent: { provider: 'binary' },
        verbose: false,
        defaultLabels: ['P1'],
      } as any);

      // Recreate command with updated config
      command = new StoryCommand(
        mockLogger,
        mockConfig,
        mockState,
        mockGit,
        mockGitHub,
        mockGuard,
        '/test/project'
      );

      vi.mocked(fs.readFile).mockResolvedValue('# Spec');
      mockConfirm(['y', 'y']);
      mockLLMService.isAvailable.mockResolvedValue(true);
      mockLLMService.structureIssue.mockResolvedValue({
        title: 'Parent',
        body: 'Body.',
      });
      mockLLMService.decomposeStory.mockResolvedValue([
        { title: 'Child 1', body: 'Parent story: #10\n\nWork.', labels: ['backend'] },
      ]);
      vi.mocked(mockGitHub.createIssue)
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(11);

      await command.execute({ file: 'spec.md' });

      const parentCall = vi.mocked(mockGitHub.createIssue).mock.calls[0][0];
      expect(parentCall.labels).toContain('P1');
      expect(parentCall.labels).toContain('story');

      const childCall = vi.mocked(mockGitHub.createIssue).mock.calls[1][0];
      expect(childCall.labels).toContain('P1');
      expect(childCall.labels).toContain('rig-created');
    });

    it('handles child issue creation failure without stopping other children', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('# Spec');
      mockConfirm(['y', 'y']);
      mockLLMService.isAvailable.mockResolvedValue(true);
      mockLLMService.structureIssue.mockResolvedValue({
        title: 'Parent',
        body: 'Body.',
      });
      mockLLMService.decomposeStory.mockResolvedValue([
        { title: 'Child 1', body: 'Work 1.', labels: [] },
        { title: 'Child 2', body: 'Work 2.', labels: [] },
        { title: 'Child 3', body: 'Work 3.', labels: [] },
      ]);
      vi.mocked(mockGitHub.createIssue)
        .mockResolvedValueOnce(10)  // parent
        .mockResolvedValueOnce(11)  // child 1
        .mockRejectedValueOnce(new Error('Rate limited'))  // child 2 fails
        .mockResolvedValueOnce(13); // child 3

      await command.execute({ file: 'spec.md' });

      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to create child issue "Child 2"'));
      expect(mockLogger.success).toHaveBeenCalledWith('Created 2 child issues for story #10');
    });

    it('displays child issue titles in preview', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('# Spec');
      mockConfirm(['y', 'n']); // confirm parent, decline children
      mockLLMService.isAvailable.mockResolvedValue(true);
      mockLLMService.structureIssue.mockResolvedValue({
        title: 'Parent',
        body: 'Body.',
      });
      vi.mocked(mockGitHub.createIssue).mockResolvedValueOnce(10);
      mockLLMService.decomposeStory.mockResolvedValue([
        { title: 'cli: Add story label', body: 'Work.', labels: [] },
        { title: 'cli: Add decomposeStory', body: 'Work.', labels: [] },
      ]);

      await command.execute({ file: 'spec.md' });

      expect(consoleLogSpy).toHaveBeenCalledWith('  - cli: Add story label');
      expect(consoleLogSpy).toHaveBeenCalledWith('  - cli: Add decomposeStory');
      expect(mockLogger.info).toHaveBeenCalledWith('2 issues to create:');
    });
  });
});
