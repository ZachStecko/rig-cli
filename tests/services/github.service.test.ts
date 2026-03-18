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

  describe('listIssues', () => {
    it('lists all open issues by default', async () => {
      const mockIssues = [
        { number: 1, title: 'Issue 1', body: 'Body 1', labels: [], assignees: [] },
        { number: 2, title: 'Issue 2', body: 'Body 2', labels: [], assignees: [] },
      ];

      mockExec.mockResolvedValue({
        stdout: JSON.stringify(mockIssues),
        stderr: '',
        exitCode: 0,
      });

      const result = await githubService.listIssues();

      expect(result).toEqual(mockIssues);
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('issue list --json number,title,body,labels,assignees'),
        { cwd: projectRoot }
      );
    });

    it('filters issues by state', async () => {
      mockExec.mockResolvedValue({
        stdout: '[]',
        stderr: '',
        exitCode: 0,
      });

      await githubService.listIssues({ state: 'closed' });

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('--state closed'),
        { cwd: projectRoot }
      );
    });

    it('filters issues by labels', async () => {
      mockExec.mockResolvedValue({
        stdout: '[]',
        stderr: '',
        exitCode: 0,
      });

      await githubService.listIssues({ labels: ['bug', 'p0'] });

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('--label bug,p0'),
        { cwd: projectRoot }
      );
    });

    it('filters issues by assignee', async () => {
      mockExec.mockResolvedValue({
        stdout: '[]',
        stderr: '',
        exitCode: 0,
      });

      await githubService.listIssues({ assignee: 'alice' });

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('--assignee alice'),
        { cwd: projectRoot }
      );
    });

    it('limits number of issues', async () => {
      mockExec.mockResolvedValue({
        stdout: '[]',
        stderr: '',
        exitCode: 0,
      });

      await githubService.listIssues({ limit: 10 });

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('--limit 10'),
        { cwd: projectRoot }
      );
    });

    it('returns empty array when no issues', async () => {
      mockExec.mockResolvedValue({
        stdout: '[]',
        stderr: '',
        exitCode: 0,
      });

      const result = await githubService.listIssues();

      expect(result).toEqual([]);
    });

    it('throws when label contains semicolons (command injection)', async () => {
      await expect(
        githubService.listIssues({ labels: ['bug; rm -rf /'] })
      ).rejects.toThrow('Invalid label');
      expect(mockExec).not.toHaveBeenCalled();
    });

    it('throws when label contains pipes', async () => {
      await expect(
        githubService.listIssues({ labels: ['bug | cat /etc/passwd'] })
      ).rejects.toThrow('Invalid label');
      expect(mockExec).not.toHaveBeenCalled();
    });

    it('throws when assignee contains semicolons (command injection)', async () => {
      await expect(
        githubService.listIssues({ assignee: 'alice; rm -rf /' })
      ).rejects.toThrow('Invalid username');
      expect(mockExec).not.toHaveBeenCalled();
    });

    it('throws when assignee contains pipes', async () => {
      await expect(
        githubService.listIssues({ assignee: 'alice | cat /etc/passwd' })
      ).rejects.toThrow('Invalid username');
      expect(mockExec).not.toHaveBeenCalled();
    });

    it('throws when assignee starts with hyphen', async () => {
      await expect(
        githubService.listIssues({ assignee: '-evil' })
      ).rejects.toThrow('Usernames cannot start with a hyphen');
      expect(mockExec).not.toHaveBeenCalled();
    });

    it('accepts valid labels with spaces, colons, and dots', async () => {
      mockExec.mockResolvedValue({
        stdout: '[]',
        stderr: '',
        exitCode: 0,
      });

      await githubService.listIssues({ labels: ['bug fix', 'priority:p0', 'v2.0'] });

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('--label bug fix,priority:p0,v2.0'),
        { cwd: projectRoot }
      );
    });

    it('throws when JSON parsing fails', async () => {
      mockExec.mockResolvedValue({
        stdout: 'invalid json{',
        stderr: '',
        exitCode: 0,
      });

      await expect(githubService.listIssues()).rejects.toThrow(
        'Failed to parse GitHub CLI JSON output'
      );
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

  describe('issueBody', () => {
    it('returns issue body text', async () => {
      mockExec.mockResolvedValue({
        stdout: 'This is the issue description\n',
        stderr: '',
        exitCode: 0,
      });

      const result = await githubService.issueBody(123);

      expect(result).toBe('This is the issue description');
      expect(mockExec).toHaveBeenCalledWith(
        'gh issue view 123 --json body --jq .body',
        { cwd: projectRoot }
      );
    });
  });

  describe('issueTitle', () => {
    it('returns issue title', async () => {
      mockExec.mockResolvedValue({
        stdout: 'Fix authentication bug\n',
        stderr: '',
        exitCode: 0,
      });

      const result = await githubService.issueTitle(123);

      expect(result).toBe('Fix authentication bug');
      expect(mockExec).toHaveBeenCalledWith(
        'gh issue view 123 --json title --jq .title',
        { cwd: projectRoot }
      );
    });
  });

  describe('issueLabels', () => {
    it('returns array of label names', async () => {
      mockExec.mockResolvedValue({
        stdout: 'bug\np0\nbackend\n',
        stderr: '',
        exitCode: 0,
      });

      const result = await githubService.issueLabels(123);

      expect(result).toEqual(['bug', 'p0', 'backend']);
    });

    it('returns empty array when no labels', async () => {
      mockExec.mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const result = await githubService.issueLabels(123);

      expect(result).toEqual([]);
    });
  });

  describe('issueState', () => {
    it('returns OPEN for open issues', async () => {
      mockExec.mockResolvedValue({
        stdout: 'OPEN\n',
        stderr: '',
        exitCode: 0,
      });

      const result = await githubService.issueState(123);

      expect(result).toBe('OPEN');
    });

    it('returns CLOSED for closed issues', async () => {
      mockExec.mockResolvedValue({
        stdout: 'CLOSED\n',
        stderr: '',
        exitCode: 0,
      });

      const result = await githubService.issueState(456);

      expect(result).toBe('CLOSED');
    });
  });

  describe('hasOpenPr', () => {
    it('returns true when issue has open PR', async () => {
      mockExec.mockResolvedValue({
        stdout: JSON.stringify([{ number: 10 }]),
        stderr: '',
        exitCode: 0,
      });

      const result = await githubService.hasOpenPr(123);

      expect(result).toBe(true);
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('pr list --search "123 in:title,body"'),
        { cwd: projectRoot }
      );
    });

    it('returns false when no open PR', async () => {
      mockExec.mockResolvedValue({
        stdout: '[]',
        stderr: '',
        exitCode: 0,
      });

      const result = await githubService.hasOpenPr(123);

      expect(result).toBe(false);
    });

    it('throws when JSON parsing fails', async () => {
      mockExec.mockResolvedValue({
        stdout: 'invalid json{',
        stderr: '',
        exitCode: 0,
      });

      await expect(githubService.hasOpenPr(123)).rejects.toThrow(
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

  describe('prComment', () => {
    it('adds comment to PR', async () => {
      // First call: repoName() fetches owner/repo
      mockExec.mockResolvedValueOnce({
        stdout: 'owner/repo\n',
        stderr: '',
        exitCode: 0,
      });
      // Second call: gh api to post comment
      mockExec.mockResolvedValueOnce({
        stdout: '12345\n',
        stderr: '',
        exitCode: 0,
      });

      const commentId = await githubService.prComment(10, 'This looks good!');

      expect(commentId).toBe(12345);
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('gh api repos/owner/repo/issues/10/comments'),
        { cwd: projectRoot }
      );
    });
  });

  describe('listPrReviewComments', () => {
    it('fetches review comments with code context', async () => {
      // First call: repoName() fetches owner/repo
      mockExec.mockResolvedValueOnce({
        stdout: 'owner/repo\n',
        stderr: '',
        exitCode: 0,
      });
      // Second call: gh api to fetch review comments
      const comment1 = {
        id: 1001,
        body: 'This needs error handling',
        path: 'src/auth.ts',
        line: 42,
        diff_hunk: '@@ -40,3 +40,5 @@\n function login() {\n+  return user;\n }',
        user: { login: 'reviewer1' }
      };
      const comment2 = {
        id: 1002,
        body: 'Add validation here',
        path: 'src/validators.ts',
        start_line: 10,
        line: 15,
        diff_hunk: '@@ -8,6 +8,8 @@\n function validate() {\n+  // code\n }',
        user: { login: 'reviewer2' }
      };
      mockExec.mockResolvedValueOnce({
        stdout: JSON.stringify(comment1) + '\n' + JSON.stringify(comment2) + '\n',
        stderr: '',
        exitCode: 0,
      });

      const comments = await githubService.listPrReviewComments(123);

      expect(comments).toHaveLength(2);
      expect(comments[0]).toEqual(comment1);
      expect(comments[1]).toEqual(comment2);
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('gh api repos/owner/repo/pulls/123/comments'),
        { cwd: projectRoot }
      );
    });

    it('returns empty array when no review comments exist', async () => {
      // First call: repoName()
      mockExec.mockResolvedValueOnce({
        stdout: 'owner/repo\n',
        stderr: '',
        exitCode: 0,
      });
      // Second call: gh api returns empty result
      mockExec.mockResolvedValueOnce({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const comments = await githubService.listPrReviewComments(123);

      expect(comments).toEqual([]);
    });

    it('throws when JSON parsing fails', async () => {
      // First call: repoName()
      mockExec.mockResolvedValueOnce({
        stdout: 'owner/repo\n',
        stderr: '',
        exitCode: 0,
      });
      // Second call: gh api returns invalid JSON
      mockExec.mockResolvedValueOnce({
        stdout: 'invalid json{',
        stderr: '',
        exitCode: 0,
      });

      await expect(githubService.listPrReviewComments(123)).rejects.toThrow(
        'Failed to parse GitHub API review comments'
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
