import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { CreateIssueCommand } from '../../src/commands/create-issue.command.js';
import { Logger } from '../../src/services/logger.service.js';
import { ConfigManager } from '../../src/services/config-manager.service.js';
import { GitService } from '../../src/services/git.service.js';
import { GitHubService } from '../../src/services/github.service.js';
import { GuardService } from '../../src/services/guard.service.js';

const VALID_BODY = `## Problem / Motivation

Something is broken.

## Implementation Details

Fix it in src/services/foo.service.ts.

## Acceptance Criteria

- It works`;

const VALID_ISSUE = `---
labels: [backend, enhancement]
---
# cli: Fix the thing

${VALID_BODY}
`;

describe('CreateIssueCommand', () => {
  let command: CreateIssueCommand;
  let mockLogger: Logger;
  let mockConfig: ConfigManager;
  let mockGit: GitService;
  let mockGitHub: GitHubService;
  let mockGuard: GuardService;
  let consoleLogSpy: any;
  let exitSpy: any;
  let dir: string;

  const writeIssueFile = async (content: string): Promise<string> => {
    const filePath = join(dir, 'issue.md');
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

    mockGit = {
      currentBranch: vi.fn(),
    } as any;

    mockGitHub = {
      createIssue: vi.fn().mockResolvedValue(42),
      repoName: vi.fn().mockResolvedValue('owner/repo'),
      ensureLabels: vi.fn().mockResolvedValue([]),
    } as any;

    mockGuard = {
      requireGhAuth: vi.fn(),
    } as any;

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    dir = await mkdtemp(join(tmpdir(), 'rig-test-'));

    command = new CreateIssueCommand(
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

  describe('execute', () => {
    it('checks GitHub authentication before proceeding', async () => {
      const filePath = await writeIssueFile(VALID_ISSUE);

      await command.execute({ file: filePath, yes: true });

      expect(mockGuard.requireGhAuth).toHaveBeenCalled();
    });

    it('requires --file', async () => {
      await command.execute({ yes: true });

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('requires --file')
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(mockGitHub.createIssue).not.toHaveBeenCalled();
    });

    it('files the issue verbatim: H1 title, body unchanged, front-matter labels', async () => {
      const filePath = await writeIssueFile(VALID_ISSUE);

      await command.execute({ file: filePath, yes: true });

      expect(mockGitHub.createIssue).toHaveBeenCalledWith({
        title: 'cli: Fix the thing',
        body: VALID_BODY,
        labels: ['backend', 'enhancement'],
      });
      expect(mockLogger.success).toHaveBeenCalledWith('Issue #42 created successfully!');
      expect(consoleLogSpy).toHaveBeenCalledWith('  https://github.com/owner/repo/issues/42');
    });

    it('preserves code fences in the body', async () => {
      const bodyWithCode = `${VALID_BODY}\n\n\`\`\`typescript\nconst x = 1;\n\`\`\``;
      const filePath = await writeIssueFile(`# Title\n\n${bodyWithCode}`);

      await command.execute({ file: filePath, yes: true });

      const issueBody = vi.mocked(mockGitHub.createIssue).mock.calls[0][0].body;
      expect(issueBody).toContain('```typescript');
      expect(issueBody).toBe(bodyWithCode);
    });

    it('exits naming the missing sections for an incomplete body', async () => {
      const filePath = await writeIssueFile(
        '# Title\n\n## Problem / Motivation\n\nOnly this.'
      );

      await command.execute({ file: filePath, yes: true });

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('"## Implementation Details", "## Acceptance Criteria"')
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(mockGitHub.createIssue).not.toHaveBeenCalled();
    });

    it('exits when the file has no H1 title', async () => {
      const filePath = await writeIssueFile(VALID_BODY);

      await command.execute({ file: filePath, yes: true });

      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('No title found'));
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(mockGitHub.createIssue).not.toHaveBeenCalled();
    });

    it('exits when the --file path cannot be read', async () => {
      await command.execute({ file: '/nonexistent/issue.md', yes: true });

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('/nonexistent/issue.md')
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(mockGitHub.createIssue).not.toHaveBeenCalled();
    });

    it('merges --label flags and config defaults with front-matter labels', async () => {
      vi.mocked(mockConfig.get).mockReturnValue({
        git: {},
        verbose: false,
        defaultLabels: ['rig-generated'],
      } as any);
      const filePath = await writeIssueFile(VALID_ISSUE);

      await command.execute({ file: filePath, label: ['P1', 'backend'], yes: true });

      expect(mockGitHub.createIssue).toHaveBeenCalledWith({
        title: 'cli: Fix the thing',
        body: VALID_BODY,
        labels: ['backend', 'enhancement', 'P1', 'rig-generated'],
      });
    });

    it('ensures labels exist before creating the issue', async () => {
      vi.mocked(mockGitHub.ensureLabels).mockResolvedValue(['enhancement']);
      const filePath = await writeIssueFile(VALID_ISSUE);

      await command.execute({ file: filePath, yes: true });

      expect(mockGitHub.ensureLabels).toHaveBeenCalledWith(['backend', 'enhancement']);
      expect(mockLogger.info).toHaveBeenCalledWith('Created missing labels: enhancement');
    });

    it('files an issue without labels when none are given', async () => {
      const filePath = await writeIssueFile(`# Title\n\n${VALID_BODY}`);

      await command.execute({ file: filePath, yes: true });

      expect(mockGitHub.createIssue).toHaveBeenCalledWith({
        title: 'Title',
        body: VALID_BODY,
        labels: undefined,
      });
      expect(mockGitHub.ensureLabels).not.toHaveBeenCalled();
    });

    it('rejects invalid labels from any source and provides a helpful message', async () => {
      const filePath = await writeIssueFile(
        `---\nlabels: [not-a-label]\n---\n# Title\n\n${VALID_BODY}`
      );

      await command.execute({ file: filePath, label: ['also-bad'], yes: true });

      expect(mockLogger.error).toHaveBeenCalledWith('Invalid labels: not-a-label, also-bad');
      expect(mockLogger.info).toHaveBeenCalledWith('Valid labels are defined in src/types/labels.types.ts');
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Examples:'));
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(mockGitHub.createIssue).not.toHaveBeenCalled();
    });

    it('handles GitHub issue creation errors gracefully', async () => {
      vi.mocked(mockGitHub.createIssue).mockRejectedValue(new Error('GitHub API error'));
      const filePath = await writeIssueFile(VALID_ISSUE);

      await command.execute({ file: filePath, yes: true });

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to create issue: GitHub API error');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('displays a preview before filing', async () => {
      const filePath = await writeIssueFile(VALID_ISSUE);

      await command.execute({ file: filePath, yes: true });

      expect(mockLogger.header).toHaveBeenCalledWith('Preview');
      expect(consoleLogSpy).toHaveBeenCalledWith('  cli: Fix the thing');
    });
  });
});
