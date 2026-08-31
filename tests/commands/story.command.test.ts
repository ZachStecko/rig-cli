import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { StoryCommand } from '../../src/commands/story.command.js';
import { Logger } from '../../src/services/logger.service.js';
import { ConfigManager } from '../../src/services/config-manager.service.js';
import { GitService } from '../../src/services/git.service.js';
import { GitHubService } from '../../src/services/github.service.js';
import { GuardService } from '../../src/services/guard.service.js';

const VALID_STORY = `---
labels: [feature]
---
# Build the widget system

The story body describing the whole effort.

## Issue: Add the widget model
labels: [backend]
Model body text.

## Issue: Wire the widget API

API body text.
`;

describe('StoryCommand', () => {
  let command: StoryCommand;
  let mockLogger: Logger;
  let mockConfig: ConfigManager;
  let mockGit: GitService;
  let mockGitHub: GitHubService;
  let mockGuard: GuardService;
  let consoleLogSpy: any;
  let exitSpy: any;
  let dir: string;

  const writeStoryFile = async (content: string): Promise<string> => {
    const filePath = join(dir, 'story.md');
    await writeFile(filePath, content);
    return filePath;
  };

  beforeEach(async () => {
    mockLogger = {
      header: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      dim: vi.fn(),
      config: vi.fn(),
      command: vi.fn(),
    } as any;

    mockConfig = {
      load: vi.fn(),
      get: vi.fn().mockReturnValue({ git: {}, verbose: false }),
    } as any;

    mockGit = {} as any;

    mockGitHub = {
      createIssue: vi.fn().mockResolvedValueOnce(10).mockResolvedValueOnce(11).mockResolvedValueOnce(12),
      repoName: vi.fn().mockResolvedValue('owner/repo'),
      ensureLabels: vi.fn().mockResolvedValue([]),
    } as any;

    mockGuard = {
      requireGhAuth: vi.fn(),
    } as any;

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    dir = await mkdtemp(join(tmpdir(), 'rig-test-'));

    command = new StoryCommand(
      mockLogger,
      mockConfig,
      mockGit,
      mockGitHub,
      mockGuard,
      '/test/project'
    );
  });

  afterEach(async () => {
    consoleLogSpy.mockRestore();
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it('requires --file', async () => {
    await command.execute({ yes: true });

    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('requires --file'));
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockGitHub.createIssue).not.toHaveBeenCalled();
  });

  it('files the parent first, then children linked with "Part of #N"', async () => {
    const filePath = await writeStoryFile(VALID_STORY);

    await command.execute({ file: filePath, yes: true });

    const calls = vi.mocked(mockGitHub.createIssue).mock.calls;
    expect(calls).toHaveLength(3);

    expect(calls[0][0]).toEqual({
      title: 'Build the widget system',
      body: 'The story body describing the whole effort.',
      labels: ['story', 'rig-created', 'feature'],
    });
    expect(calls[1][0]).toEqual({
      title: 'Add the widget model',
      body: 'Model body text.\n\nPart of #10',
      labels: ['rig-created', 'backend'],
    });
    expect(calls[2][0]).toEqual({
      title: 'Wire the widget API',
      body: 'API body text.\n\nPart of #10',
      labels: ['rig-created'],
    });

    expect(mockLogger.success).toHaveBeenCalledWith('Parent story #10 created');
    expect(mockLogger.success).toHaveBeenCalledWith('Created 2 child issues for story #10');
  });

  it('merges config default labels into parent and children', async () => {
    vi.mocked(mockConfig.get).mockReturnValue({
      git: {},
      verbose: false,
      defaultLabels: ['node'],
    } as any);
    const filePath = await writeStoryFile(VALID_STORY);

    await command.execute({ file: filePath, yes: true });

    const calls = vi.mocked(mockGitHub.createIssue).mock.calls;
    expect(calls[0][0].labels).toEqual(['story', 'rig-created', 'feature', 'node']);
    expect(calls[1][0].labels).toEqual(['rig-created', 'backend', 'node']);
  });

  it('exits before creating anything when a label is invalid', async () => {
    const filePath = await writeStoryFile(
      VALID_STORY.replace('labels: [backend]', 'labels: [bogus-label]')
    );

    await command.execute({ file: filePath, yes: true });

    expect(mockLogger.error).toHaveBeenCalledWith('Invalid labels: bogus-label');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockGitHub.createIssue).not.toHaveBeenCalled();
  });

  it('exits with a format error when the file has no children', async () => {
    const filePath = await writeStoryFile('# Story\n\nBody only.');

    await command.execute({ file: filePath, yes: true });

    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('No child issues found'));
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockGitHub.createIssue).not.toHaveBeenCalled();
  });

  it('exits when the --file path cannot be read', async () => {
    await command.execute({ file: '/nonexistent/story.md', yes: true });

    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('/nonexistent/story.md'));
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockGitHub.createIssue).not.toHaveBeenCalled();
  });

  it('exits when parent creation fails', async () => {
    vi.mocked(mockGitHub.createIssue).mockReset();
    vi.mocked(mockGitHub.createIssue).mockRejectedValue(new Error('GitHub down'));
    const filePath = await writeStoryFile(VALID_STORY);

    await command.execute({ file: filePath, yes: true });

    expect(mockLogger.error).toHaveBeenCalledWith('Failed to create parent story: GitHub down');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('continues with remaining children when one child fails', async () => {
    vi.mocked(mockGitHub.createIssue).mockReset();
    vi.mocked(mockGitHub.createIssue)
      .mockResolvedValueOnce(10)
      .mockRejectedValueOnce(new Error('flaky'))
      .mockResolvedValueOnce(12);
    const filePath = await writeStoryFile(VALID_STORY);

    await command.execute({ file: filePath, yes: true });

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to create child issue "Add the widget model": flaky'
    );
    expect(mockLogger.warn).toHaveBeenCalledWith('1 of 2 child issues failed to create.');
    expect(mockLogger.success).toHaveBeenCalledWith('Created 1 child issues for story #10');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('exits when no child issues could be created', async () => {
    vi.mocked(mockGitHub.createIssue).mockReset();
    vi.mocked(mockGitHub.createIssue)
      .mockResolvedValueOnce(10)
      .mockRejectedValue(new Error('flaky'));
    const filePath = await writeStoryFile(VALID_STORY);

    await command.execute({ file: filePath, yes: true });

    expect(mockLogger.error).toHaveBeenCalledWith('No child issues were created for story #10.');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('lists child titles in the preview', async () => {
    const filePath = await writeStoryFile(VALID_STORY);

    await command.execute({ file: filePath, yes: true });

    expect(mockLogger.info).toHaveBeenCalledWith('2 issues to create:');
    expect(consoleLogSpy).toHaveBeenCalledWith('  - Add the widget model');
    expect(consoleLogSpy).toHaveBeenCalledWith('  - Wire the widget API');
  });
});
