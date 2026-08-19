import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GitHubService } from '../../src/services/github.service.js';
import * as shell from '../../src/utils/shell.js';

// Mock the shell module
vi.mock('../../src/utils/shell.js', () => ({
  exec: vi.fn(),
}));

describe('GitHubService', () => {
  let githubService: GitHubService;
  const projectRoot = '/test/project';
  const mockExec = vi.mocked(shell.exec);

  beforeEach(() => {
    githubService = new GitHubService(projectRoot);
    mockExec.mockClear();
  });

  describe('isInstalled', () => {
    it('returns true when gh is installed', async () => {
      mockExec.mockResolvedValue({
        stdout: 'gh version 2.40.0\n',
        stderr: '',
        exitCode: 0,
      });

      const result = await githubService.isInstalled();

      expect(result).toBe(true);
      expect(mockExec).toHaveBeenCalledWith('gh --version');
    });

    it('returns false when gh is not installed', async () => {
      mockExec.mockResolvedValue({
        stdout: '',
        stderr: 'command not found: gh',
        exitCode: 127,
      });

      const result = await githubService.isInstalled();

      expect(result).toBe(false);
    });
  });

  describe('isAuthenticated', () => {
    it('returns true when authenticated', async () => {
      mockExec.mockResolvedValue({
        stdout: 'Logged in to github.com as user\n',
        stderr: '',
        exitCode: 0,
      });

      const result = await githubService.isAuthenticated();

      expect(result).toBe(true);
      expect(mockExec).toHaveBeenCalledWith('gh auth status');
    });

    it('returns false when not authenticated', async () => {
      mockExec.mockResolvedValue({
        stdout: '',
        stderr: 'Not logged in',
        exitCode: 1,
      });

      const result = await githubService.isAuthenticated();

      expect(result).toBe(false);
    });
  });

  describe('repoName', () => {
    it('returns repository name in owner/repo format', async () => {
      mockExec.mockResolvedValue({
        stdout: 'owner/repo\n',
        stderr: '',
        exitCode: 0,
      });

      const result = await githubService.repoName();

      expect(result).toBe('owner/repo');
      expect(mockExec).toHaveBeenCalledWith(
        'gh repo view --json nameWithOwner --jq .nameWithOwner',
        { cwd: projectRoot }
      );
    });

    it('throws when not in a GitHub repository', async () => {
      mockExec.mockResolvedValue({
        stdout: '',
        stderr: 'error: not a git repository',
        exitCode: 1,
      });

      await expect(githubService.repoName()).rejects.toThrow('GitHub CLI command failed');
    });
  });

  describe('viewIssue', () => {
    it('returns issue details', async () => {
      const mockIssue = {
        number: 123,
        title: 'Fix bug',
        body: 'Description',
        labels: [{ name: 'bug' }],
        assignees: [],
        state: 'OPEN',
      };

      mockExec.mockResolvedValue({
        stdout: JSON.stringify(mockIssue),
        stderr: '',
        exitCode: 0,
      });

      const result = await githubService.viewIssue(123);

      expect(result).toEqual(mockIssue);
      expect(mockExec).toHaveBeenCalledWith(
        'gh issue view 123 --json number,title,body,labels,assignees,state',
        { cwd: projectRoot }
      );
    });

    it('throws when issue does not exist', async () => {
      mockExec.mockResolvedValue({
        stdout: '',
        stderr: 'issue not found',
        exitCode: 1,
      });

      await expect(githubService.viewIssue(999)).rejects.toThrow();
    });

    it('throws when JSON parsing fails', async () => {
      mockExec.mockResolvedValue({
        stdout: 'invalid json{',
        stderr: '',
        exitCode: 0,
      });

      await expect(githubService.viewIssue(123)).rejects.toThrow(
        'Failed to parse GitHub CLI JSON output'
      );
    });
  });

  describe('prListByHead', () => {
    it('returns list of PRs by branch name', async () => {
      const mockPrs = [
        { number: 10, title: 'Fix bug' },
        { number: 11, title: 'Add feature' },
      ];

      mockExec.mockResolvedValue({
        stdout: JSON.stringify(mockPrs),
        stderr: '',
        exitCode: 0,
      });

      const result = await githubService.prListByHead('issue-123-fix-bug');

      expect(result).toEqual(mockPrs);
      expect(mockExec).toHaveBeenCalledWith(
        'gh pr list --head issue-123-fix-bug --json number,title',
        { cwd: projectRoot }
      );
    });

    it('returns empty array when no PRs', async () => {
      mockExec.mockResolvedValue({
        stdout: '[]',
        stderr: '',
        exitCode: 0,
      });

      const result = await githubService.prListByHead('non-existent-branch');

      expect(result).toEqual([]);
    });

    it('throws when branch name contains spaces', async () => {
      await expect(githubService.prListByHead('bad branch name')).rejects.toThrow(
        'Invalid branch name'
      );
      expect(mockExec).not.toHaveBeenCalled();
    });

    it('throws when branch name contains semicolons (command injection)', async () => {
      await expect(githubService.prListByHead('evil; rm -rf /')).rejects.toThrow(
        'Invalid branch name'
      );
      expect(mockExec).not.toHaveBeenCalled();
    });

    it('throws when branch name contains pipes', async () => {
      await expect(githubService.prListByHead('evil | cat /etc/passwd')).rejects.toThrow(
        'Invalid branch name'
      );
      expect(mockExec).not.toHaveBeenCalled();
    });

    it('throws when branch name starts with dash', async () => {
      await expect(githubService.prListByHead('-evil')).rejects.toThrow(
        'Branch names cannot start with a dash'
      );
      expect(mockExec).not.toHaveBeenCalled();
    });

    it('throws when JSON parsing fails', async () => {
      mockExec.mockResolvedValue({
        stdout: 'invalid json{',
        stderr: '',
        exitCode: 0,
      });

      await expect(githubService.prListByHead('valid-branch')).rejects.toThrow(
        'Failed to parse GitHub CLI JSON output'
      );
    });
  });

  describe('createPr', () => {
    it('creates PR and returns URL', async () => {
      mockExec.mockResolvedValue({
        stdout: 'https://github.com/owner/repo/pull/10\n',
        stderr: '',
        exitCode: 0,
      });

      const result = await githubService.createPr({
        title: 'Fix bug',
        body: 'This fixes the bug',
      });

      expect(result).toBe('https://github.com/owner/repo/pull/10');
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('pr create --title "Fix bug" --body-file'),
        { cwd: projectRoot }
      );
    });

    it('creates draft PR when draft option is true', async () => {
      mockExec.mockResolvedValue({
        stdout: 'https://github.com/owner/repo/pull/10\n',
        stderr: '',
        exitCode: 0,
      });

      await githubService.createPr({
        title: 'Fix bug',
        body: 'Description',
        draft: true,
      });

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('--draft'),
        { cwd: projectRoot }
      );
    });

    it('creates PR with custom base branch', async () => {
      mockExec.mockResolvedValue({
        stdout: 'https://github.com/owner/repo/pull/10\n',
        stderr: '',
        exitCode: 0,
      });

      await githubService.createPr({
        title: 'Fix bug',
        body: 'Description',
        base: 'develop',
      });

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('--base develop'),
        { cwd: projectRoot }
      );
    });

    it('escapes double quotes in title', async () => {
      mockExec.mockResolvedValue({
        stdout: 'https://github.com/owner/repo/pull/10\n',
        stderr: '',
        exitCode: 0,
      });

      await githubService.createPr({
        title: 'Fix "authentication" bug',
        body: 'Description',
      });

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('--title "Fix \\"authentication\\" bug"'),
        { cwd: projectRoot }
      );
    });

    it('prevents quote injection attack in title', async () => {
      mockExec.mockResolvedValue({
        stdout: 'https://github.com/owner/repo/pull/10\n',
        stderr: '',
        exitCode: 0,
      });

      await githubService.createPr({
        title: 'Title"; rm -rf /',
        body: 'Body',
      });

      // The quotes should be escaped in title, preventing command injection
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('--title "Title\\"; rm -rf /"'),
        { cwd: projectRoot }
      );
    });

    it('throws when base branch contains semicolons (command injection)', async () => {
      await expect(
        githubService.createPr({
          title: 'Fix bug',
          body: 'Description',
          base: 'main; rm -rf /',
        })
      ).rejects.toThrow('Invalid branch name');
      expect(mockExec).not.toHaveBeenCalled();
    });

    it('throws when base branch contains pipes', async () => {
      await expect(
        githubService.createPr({
          title: 'Fix bug',
          body: 'Description',
          base: 'main | cat /etc/passwd',
        })
      ).rejects.toThrow('Invalid branch name');
      expect(mockExec).not.toHaveBeenCalled();
    });

    it('throws when base branch starts with dash', async () => {
      await expect(
        githubService.createPr({
          title: 'Fix bug',
          body: 'Description',
          base: '-evil',
        })
      ).rejects.toThrow('Branch names cannot start with a dash');
      expect(mockExec).not.toHaveBeenCalled();
    });
  });

  describe('editPr', () => {
    it('edits PR title', async () => {
      mockExec.mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      await githubService.editPr(10, { title: 'New title' });

      expect(mockExec).toHaveBeenCalledWith(
        'gh pr edit 10 --title "New title"',
        { cwd: projectRoot }
      );
    });

    it('edits PR body', async () => {
      mockExec.mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      await githubService.editPr(10, { body: 'New body' });

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('gh pr edit 10 --body-file'),
        { cwd: projectRoot }
      );
    });

    it('edits both title and body', async () => {
      mockExec.mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      await githubService.editPr(10, {
        title: 'New title',
        body: 'New body',
      });

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('gh pr edit 10 --title "New title" --body-file'),
        { cwd: projectRoot }
      );
    });

    it('escapes double quotes in title', async () => {
      mockExec.mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      await githubService.editPr(10, { title: 'Fix "bug"' });

      expect(mockExec).toHaveBeenCalledWith(
        'gh pr edit 10 --title "Fix \\"bug\\""',
        { cwd: projectRoot }
      );
    });
  });

  describe('listLabels', () => {
    it('returns label names from repository', async () => {
      mockExec.mockResolvedValue({
        stdout: JSON.stringify([{ name: 'bug' }, { name: 'enhancement' }]),
        stderr: '',
        exitCode: 0,
      });

      const result = await githubService.listLabels();

      expect(result).toEqual(['bug', 'enhancement']);
      expect(mockExec).toHaveBeenCalledWith(
        'gh label list --json name',
        { cwd: projectRoot }
      );
    });

    it('returns empty array when no labels exist', async () => {
      mockExec.mockResolvedValue({
        stdout: '[]',
        stderr: '',
        exitCode: 0,
      });

      const result = await githubService.listLabels();

      expect(result).toEqual([]);
    });

    it('throws when JSON parsing fails', async () => {
      mockExec.mockResolvedValue({
        stdout: 'invalid json{',
        stderr: '',
        exitCode: 0,
      });

      await expect(githubService.listLabels()).rejects.toThrow(
        'Failed to parse GitHub CLI JSON output'
      );
    });
  });

  describe('syncLabels', () => {
    it('creates labels and reports created vs existing', async () => {
      // First call: listLabels
      mockExec.mockResolvedValueOnce({
        stdout: JSON.stringify([{ name: 'bug' }]),
        stderr: '',
        exitCode: 0,
      });
      // Second call: gh label create for 'bug' (existing)
      mockExec.mockResolvedValueOnce({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });
      // Third call: gh label create for 'backend' (new)
      mockExec.mockResolvedValueOnce({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const result = await githubService.syncLabels([
        { name: 'bug', color: 'd73a4a', description: 'Something broken' },
        { name: 'backend', color: '0052cc', description: 'Backend changes' },
      ]);

      expect(result.existing).toEqual(['bug']);
      expect(result.created).toEqual(['backend']);
    });

    it('calls gh label create with --force for each label', async () => {
      mockExec.mockResolvedValueOnce({
        stdout: '[]',
        stderr: '',
        exitCode: 0,
      });
      mockExec.mockResolvedValueOnce({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      await githubService.syncLabels([
        { name: 'P0', color: 'b60205', description: 'Critical' },
      ]);

      expect(mockExec).toHaveBeenCalledWith(
        'gh label create "P0" --force --color b60205 --description "Critical"',
        { cwd: projectRoot }
      );
    });

    it('handles labels without color and description', async () => {
      mockExec.mockResolvedValueOnce({
        stdout: '[]',
        stderr: '',
        exitCode: 0,
      });
      mockExec.mockResolvedValueOnce({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      await githubService.syncLabels([
        { name: 'simple' },
      ]);

      expect(mockExec).toHaveBeenCalledWith(
        'gh label create "simple" --force',
        { cwd: projectRoot }
      );
    });

    it('throws on invalid label names', async () => {
      mockExec.mockResolvedValueOnce({
        stdout: '[]',
        stderr: '',
        exitCode: 0,
      });

      await expect(
        githubService.syncLabels([{ name: 'bad;label' }])
      ).rejects.toThrow('Invalid label');
    });
  });
});
