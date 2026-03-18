import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GitService } from '../../src/services/git.service.js';
import * as shell from '../../src/utils/shell.js';

// Mock the shell module
vi.mock('../../src/utils/shell.js', () => ({
  exec: vi.fn(),
}));

describe('GitService', () => {
  let gitService: GitService;
  const projectRoot = '/test/project';
  const mockExec = vi.mocked(shell.exec);

  beforeEach(() => {
    gitService = new GitService(projectRoot);
    mockExec.mockClear();
  });

  describe('isClean', () => {
    it('returns true when working tree is clean', async () => {
      mockExec.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

      const result = await gitService.isClean();

      expect(result).toBe(true);
      expect(mockExec).toHaveBeenCalledWith(`git -C "${projectRoot}" status --porcelain`);
    });

    it('returns false when there are uncommitted changes', async () => {
      mockExec.mockResolvedValue({
        stdout: ' M src/index.ts\n?? new-file.ts',
        stderr: '',
        exitCode: 0,
      });

      const result = await gitService.isClean();

      expect(result).toBe(false);
    });

    it('throws when git command fails', async () => {
      mockExec.mockResolvedValue({
        stdout: '',
        stderr: 'fatal: not a git repository',
        exitCode: 128,
      });

      await expect(gitService.isClean()).rejects.toThrow('Git command failed');
    });
  });

  describe('currentBranch', () => {
    it('returns current branch name', async () => {
      mockExec.mockResolvedValue({
        stdout: 'issue-123-fix-bug\n',
        stderr: '',
        exitCode: 0,
      });

      const result = await gitService.currentBranch();

      expect(result).toBe('issue-123-fix-bug');
      expect(mockExec).toHaveBeenCalledWith(`git -C "${projectRoot}" rev-parse --abbrev-ref HEAD`);
    });

    it('returns main branch', async () => {
      mockExec.mockResolvedValue({
        stdout: 'main\n',
        stderr: '',
        exitCode: 0,
      });

      const result = await gitService.currentBranch();

      expect(result).toBe('main');
    });

    it('throws when not in a git repository', async () => {
      mockExec.mockResolvedValue({
        stdout: '',
        stderr: 'fatal: not a git repository',
        exitCode: 128,
      });

      await expect(gitService.currentBranch()).rejects.toThrow();
    });
  });

  describe('isOnMaster', () => {
    it('returns true when on main branch', async () => {
      mockExec.mockResolvedValue({
        stdout: 'main\n',
        stderr: '',
        exitCode: 0,
      });

      const result = await gitService.isOnMaster();

      expect(result).toBe(true);
    });

    it('returns true when on master branch', async () => {
      mockExec.mockResolvedValue({
        stdout: 'master\n',
        stderr: '',
        exitCode: 0,
      });

      const result = await gitService.isOnMaster();

      expect(result).toBe(true);
    });

    it('returns false when on feature branch', async () => {
      mockExec.mockResolvedValue({
        stdout: 'issue-123-fix-bug\n',
        stderr: '',
        exitCode: 0,
      });

      const result = await gitService.isOnMaster();

      expect(result).toBe(false);
    });
  });

  describe('isOnFeatureBranch', () => {
    it('returns false when on main branch', async () => {
      mockExec.mockResolvedValue({
        stdout: 'main\n',
        stderr: '',
        exitCode: 0,
      });

      const result = await gitService.isOnFeatureBranch();

      expect(result).toBe(false);
    });

    it('returns true when on feature branch', async () => {
      mockExec.mockResolvedValue({
        stdout: 'issue-456-add-feature\n',
        stderr: '',
        exitCode: 0,
      });

      const result = await gitService.isOnFeatureBranch();

      expect(result).toBe(true);
    });
  });

  describe('createBranch', () => {
    it('creates and checks out new branch', async () => {
      mockExec.mockResolvedValue({
        stdout: "Switched to a new branch 'issue-123-fix-bug'\n",
        stderr: '',
        exitCode: 0,
      });

      await gitService.createBranch('issue-123-fix-bug');

      expect(mockExec).toHaveBeenCalledWith(
        `git -C "${projectRoot}" checkout -b issue-123-fix-bug`
      );
    });

    it('accepts branch names with slashes, dots, and underscores', async () => {
      mockExec.mockResolvedValue({
        stdout: "Switched to a new branch 'feature/test_branch.v2'\n",
        stderr: '',
        exitCode: 0,
      });

      await gitService.createBranch('feature/test_branch.v2');

      expect(mockExec).toHaveBeenCalledWith(
        `git -C "${projectRoot}" checkout -b feature/test_branch.v2`
      );
    });

    it('throws when branch name contains spaces', async () => {
      await expect(gitService.createBranch('bad branch name')).rejects.toThrow(
        'Invalid branch name'
      );
      expect(mockExec).not.toHaveBeenCalled();
    });

    it('throws when branch name contains semicolons (command injection)', async () => {
      await expect(gitService.createBranch('evil; rm -rf /')).rejects.toThrow(
        'Invalid branch name'
      );
      expect(mockExec).not.toHaveBeenCalled();
    });

    it('throws when branch name contains pipes', async () => {
      await expect(gitService.createBranch('evil | cat /etc/passwd')).rejects.toThrow(
        'Invalid branch name'
      );
      expect(mockExec).not.toHaveBeenCalled();
    });

    it('throws when branch name starts with dash', async () => {
      await expect(gitService.createBranch('-evil')).rejects.toThrow(
        'Branch names cannot start with a dash'
      );
      expect(mockExec).not.toHaveBeenCalled();
    });

    it('throws when branch already exists', async () => {
      mockExec.mockResolvedValue({
        stdout: '',
        stderr: "fatal: A branch named 'issue-123-fix-bug' already exists.",
        exitCode: 128,
      });

      await expect(gitService.createBranch('issue-123-fix-bug')).rejects.toThrow();
    });
  });

  describe('checkoutMaster', () => {
    it('checks out main branch when it exists', async () => {
      mockExec.mockResolvedValue({
        stdout: "Switched to branch 'main'\n",
        stderr: '',
        exitCode: 0,
      });

      await gitService.checkoutMaster();

      expect(mockExec).toHaveBeenCalledWith(`git -C "${projectRoot}" checkout main`);
    });

    it('falls back to master when main does not exist', async () => {
      // First call (main) fails
      mockExec.mockResolvedValueOnce({
        stdout: '',
        stderr: "error: pathspec 'main' did not match",
        exitCode: 1,
      });

      // Second call (master) succeeds
      mockExec.mockResolvedValueOnce({
        stdout: "Switched to branch 'master'\n",
        stderr: '',
        exitCode: 0,
      });

      await gitService.checkoutMaster();

      expect(mockExec).toHaveBeenNthCalledWith(1, `git -C "${projectRoot}" checkout main`);
      expect(mockExec).toHaveBeenNthCalledWith(2, `git -C "${projectRoot}" checkout master`);
    });

    it('throws when neither main nor master exists', async () => {
      // Both calls fail
      mockExec.mockResolvedValue({
        stdout: '',
        stderr: 'error: pathspec did not match',
        exitCode: 1,
      });

      await expect(gitService.checkoutMaster()).rejects.toThrow();
    });
  });

  describe('push', () => {
    it('pushes current branch to origin with upstream', async () => {
      // First call: get current branch
      mockExec.mockResolvedValueOnce({
        stdout: 'issue-123-fix-bug\n',
        stderr: '',
        exitCode: 0,
      });

      // Second call: push
      mockExec.mockResolvedValueOnce({
        stdout: 'Branch issue-123-fix-bug set up to track remote branch',
        stderr: '',
        exitCode: 0,
      });

      await gitService.push();

      expect(mockExec).toHaveBeenCalledWith(
        `git -C "${projectRoot}" push -u origin issue-123-fix-bug`
      );
    });

    it('throws when current branch name is invalid', async () => {
      // First call: get current branch with invalid name
      mockExec.mockResolvedValueOnce({
        stdout: 'evil; rm -rf /\n',
        stderr: '',
        exitCode: 0,
      });

      await expect(gitService.push()).rejects.toThrow('Invalid branch name');
    });

    it('throws when push fails', async () => {
      // First call: get current branch
      mockExec.mockResolvedValueOnce({
        stdout: 'issue-123-fix-bug\n',
        stderr: '',
        exitCode: 0,
      });

      // Second call: push fails
      mockExec.mockResolvedValueOnce({
        stdout: '',
        stderr: 'fatal: No such remote',
        exitCode: 128,
      });

      await expect(gitService.push()).rejects.toThrow();
    });
  });

  describe('diffStatVsMaster', () => {
    it('returns diff statistics against main branch', async () => {
      // First call: check if main exists
      mockExec.mockResolvedValueOnce({
        stdout: 'abc123\n',
        stderr: '',
        exitCode: 0,
      });

      // Second call: get diff stat
      mockExec.mockResolvedValueOnce({
        stdout: ' src/index.ts | 10 +++++-----\n 1 file changed, 5 insertions(+), 5 deletions(-)\n',
        stderr: '',
        exitCode: 0,
      });

      const result = await gitService.diffStatVsMaster();

      expect(result).toContain('1 file changed');
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('diff --stat main...HEAD')
      );
    });

    it('uses master branch when main does not exist', async () => {
      // First call: main doesn't exist
      mockExec.mockResolvedValueOnce({
        stdout: '',
        stderr: 'fatal: Needed a single revision',
        exitCode: 128,
      });

      // Second call: master exists
      mockExec.mockResolvedValueOnce({
        stdout: 'def456\n',
        stderr: '',
        exitCode: 0,
      });

      // Third call: get diff stat
      mockExec.mockResolvedValueOnce({
        stdout: ' src/index.ts | 3 +++\n 1 file changed, 3 insertions(+)\n',
        stderr: '',
        exitCode: 0,
      });

      const result = await gitService.diffStatVsMaster();

      expect(result).toContain('1 file changed');
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('diff --stat master...HEAD')
      );
    });
  });

  describe('newFilesVsMaster', () => {
    it('returns list of new files', async () => {
      // First call: check main exists
      mockExec.mockResolvedValueOnce({
        stdout: 'abc123\n',
        stderr: '',
        exitCode: 0,
      });

      // Second call: get new files
      mockExec.mockResolvedValueOnce({
        stdout: 'src/new-file.ts\ntests/new-test.ts\n',
        stderr: '',
        exitCode: 0,
      });

      const result = await gitService.newFilesVsMaster();

      expect(result).toEqual(['src/new-file.ts', 'tests/new-test.ts']);
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('diff --name-only --diff-filter=A main...HEAD')
      );
    });

    it('returns empty array when no new files', async () => {
      // First call: check main exists
      mockExec.mockResolvedValueOnce({
        stdout: 'abc123\n',
        stderr: '',
        exitCode: 0,
      });

      // Second call: no new files
      mockExec.mockResolvedValueOnce({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const result = await gitService.newFilesVsMaster();

      expect(result).toEqual([]);
    });
  });

  describe('commitCountVsMaster', () => {
    it('returns number of commits ahead of main', async () => {
      // First call: check main exists
      mockExec.mockResolvedValueOnce({
        stdout: 'abc123\n',
        stderr: '',
        exitCode: 0,
      });

      // Second call: count commits
      mockExec.mockResolvedValueOnce({
        stdout: '5\n',
        stderr: '',
        exitCode: 0,
      });

      const result = await gitService.commitCountVsMaster();

      expect(result).toBe(5);
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('rev-list --count main..HEAD')
      );
    });

    it('returns 0 when no commits ahead', async () => {
      // First call: check main exists
      mockExec.mockResolvedValueOnce({
        stdout: 'abc123\n',
        stderr: '',
        exitCode: 0,
      });

      // Second call: count commits
      mockExec.mockResolvedValueOnce({
        stdout: '0\n',
        stderr: '',
        exitCode: 0,
      });

      const result = await gitService.commitCountVsMaster();

      expect(result).toBe(0);
    });

    it('throws when git returns invalid count', async () => {
      // First call: check main exists
      mockExec.mockResolvedValueOnce({
        stdout: 'abc123\n',
        stderr: '',
        exitCode: 0,
      });

      // Second call: invalid count
      mockExec.mockResolvedValueOnce({
        stdout: 'not a number\n',
        stderr: '',
        exitCode: 0,
      });

      await expect(gitService.commitCountVsMaster()).rejects.toThrow('Invalid commit count');
    });
  });

  describe('logVsMaster', () => {
    it('returns commit log against main', async () => {
      // First call: check main exists
      mockExec.mockResolvedValueOnce({
        stdout: 'abc123\n',
        stderr: '',
        exitCode: 0,
      });

      // Second call: get log
      mockExec.mockResolvedValueOnce({
        stdout: 'abc123 Add new feature\ndef456 Fix bug\n',
        stderr: '',
        exitCode: 0,
      });

      const result = await gitService.logVsMaster();

      expect(result).toContain('Add new feature');
      expect(result).toContain('Fix bug');
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('log main..HEAD --oneline')
      );
    });

    it('returns empty string when no commits ahead', async () => {
      // First call: check main exists
      mockExec.mockResolvedValueOnce({
        stdout: 'abc123\n',
        stderr: '',
        exitCode: 0,
      });

      // Second call: no commits
      mockExec.mockResolvedValueOnce({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const result = await gitService.logVsMaster();

      expect(result).toBe('');
    });
  });

  describe('changedFilesCountVsMaster', () => {
    it('returns count of changed files against main', async () => {
      // First call: check main exists
      mockExec.mockResolvedValueOnce({
        stdout: 'abc123\n',
        stderr: '',
        exitCode: 0,
      });

      // Second call: get changed files
      mockExec.mockResolvedValueOnce({
        stdout: 'src/file1.ts\nsrc/file2.ts\nsrc/file3.ts\n',
        stderr: '',
        exitCode: 0,
      });

      const result = await gitService.changedFilesCountVsMaster();

      expect(result).toBe(3);
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('diff --name-only main...HEAD')
      );
    });

    it('returns 0 when no files changed', async () => {
      // First call: check main exists
      mockExec.mockResolvedValueOnce({
        stdout: 'abc123\n',
        stderr: '',
        exitCode: 0,
      });

      // Second call: no files
      mockExec.mockResolvedValueOnce({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const result = await gitService.changedFilesCountVsMaster();

      expect(result).toBe(0);
    });

    it('uses master when main does not exist', async () => {
      // First call: main does not exist
      mockExec.mockResolvedValueOnce({
        stdout: '',
        stderr: "fatal: Needed a single revision",
        exitCode: 128,
      });

      // Second call: master exists
      mockExec.mockResolvedValueOnce({
        stdout: 'def456\n',
        stderr: '',
        exitCode: 0,
      });

      // Third call: get changed files
      mockExec.mockResolvedValueOnce({
        stdout: 'src/file1.ts\nsrc/file2.ts\n',
        stderr: '',
        exitCode: 0,
      });

      const result = await gitService.changedFilesCountVsMaster();

      expect(result).toBe(2);
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('diff --name-only master...HEAD')
      );
    });
  });

  describe('diffLinesVsMaster', () => {
    it('returns total lines changed against main', async () => {
      // First call: check main exists
      mockExec.mockResolvedValueOnce({
        stdout: 'abc123\n',
        stderr: '',
        exitCode: 0,
      });

      // Second call: get diff stat
      mockExec.mockResolvedValueOnce({
        stdout: ' src/file1.ts | 10 ++++++++++\n src/file2.ts | 5 +++++\n 2 files changed, 123 insertions(+), 45 deletions(-)\n',
        stderr: '',
        exitCode: 0,
      });

      const result = await gitService.diffLinesVsMaster();

      expect(result).toBe(168); // 123 + 45
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('diff --stat main...HEAD')
      );
    });

    it('returns 0 when no changes', async () => {
      // First call: check main exists
      mockExec.mockResolvedValueOnce({
        stdout: 'abc123\n',
        stderr: '',
        exitCode: 0,
      });

      // Second call: no diff
      mockExec.mockResolvedValueOnce({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const result = await gitService.diffLinesVsMaster();

      expect(result).toBe(0);
    });

    it('handles insertions only', async () => {
      // First call: check main exists
      mockExec.mockResolvedValueOnce({
        stdout: 'abc123\n',
        stderr: '',
        exitCode: 0,
      });

      // Second call: insertions only
      mockExec.mockResolvedValueOnce({
        stdout: ' src/file1.ts | 50 ++++++++++++++++++++++++++++++++++++++++++++++++++\n 1 file changed, 50 insertions(+)\n',
        stderr: '',
        exitCode: 0,
      });

      const result = await gitService.diffLinesVsMaster();

      expect(result).toBe(50);
    });

    it('handles deletions only', async () => {
      // First call: check main exists
      mockExec.mockResolvedValueOnce({
        stdout: 'abc123\n',
        stderr: '',
        exitCode: 0,
      });

      // Second call: deletions only
      mockExec.mockResolvedValueOnce({
        stdout: ' src/file1.ts | 30 ------------------------------\n 1 file changed, 30 deletions(-)\n',
        stderr: '',
        exitCode: 0,
      });

      const result = await gitService.diffLinesVsMaster();

      expect(result).toBe(30);
    });

    it('uses master when main does not exist', async () => {
      // First call: main does not exist
      mockExec.mockResolvedValueOnce({
        stdout: '',
        stderr: "fatal: Needed a single revision",
        exitCode: 128,
      });

      // Second call: master exists
      mockExec.mockResolvedValueOnce({
        stdout: 'def456\n',
        stderr: '',
        exitCode: 0,
      });

      // Third call: get diff stat
      mockExec.mockResolvedValueOnce({
        stdout: ' src/file1.ts | 20 ++++++++++++++++++++\n 1 file changed, 20 insertions(+)\n',
        stderr: '',
        exitCode: 0,
      });

      const result = await gitService.diffLinesVsMaster();

      expect(result).toBe(20);
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('diff --stat master...HEAD')
      );
    });
  });

  describe('configured baseBranch', () => {
    let customGit: GitService;

    beforeEach(() => {
      customGit = new GitService(projectRoot, 'develop');
      mockExec.mockClear();
    });

    it('isOnMaster returns true when on configured baseBranch', async () => {
      mockExec.mockResolvedValue({
        stdout: 'develop\n',
        stderr: '',
        exitCode: 0,
      });

      const result = await customGit.isOnMaster();

      expect(result).toBe(true);
    });

    it('isOnMaster returns false when on different branch with configured baseBranch', async () => {
      mockExec.mockResolvedValue({
        stdout: 'main\n',
        stderr: '',
        exitCode: 0,
      });

      const result = await customGit.isOnMaster();

      expect(result).toBe(false);
    });

    it('checkoutMaster checks out the configured baseBranch directly', async () => {
      mockExec.mockResolvedValue({
        stdout: "Switched to branch 'develop'\n",
        stderr: '',
        exitCode: 0,
      });

      await customGit.checkoutMaster();

      expect(mockExec).toHaveBeenCalledTimes(1);
      expect(mockExec).toHaveBeenCalledWith(`git -C "${projectRoot}" checkout develop`);
    });

    it('diffStatVsMaster uses configured baseBranch without auto-detection', async () => {
      mockExec.mockResolvedValueOnce({
        stdout: ' src/index.ts | 10 +++++-----\n 1 file changed, 5 insertions(+), 5 deletions(-)\n',
        stderr: '',
        exitCode: 0,
      });

      const result = await customGit.diffStatVsMaster();

      expect(result).toContain('1 file changed');
      expect(mockExec).toHaveBeenCalledTimes(1);
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('diff --stat develop...HEAD')
      );
    });

    it('commitCountVsMaster uses configured baseBranch', async () => {
      mockExec.mockResolvedValueOnce({
        stdout: '3\n',
        stderr: '',
        exitCode: 0,
      });

      const result = await customGit.commitCountVsMaster();

      expect(result).toBe(3);
      expect(mockExec).toHaveBeenCalledTimes(1);
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('rev-list --count develop..HEAD')
      );
    });

    it('newFilesVsMaster uses configured baseBranch', async () => {
      mockExec.mockResolvedValueOnce({
        stdout: 'src/new.ts\n',
        stderr: '',
        exitCode: 0,
      });

      const result = await customGit.newFilesVsMaster();

      expect(result).toEqual(['src/new.ts']);
      expect(mockExec).toHaveBeenCalledTimes(1);
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('diff --name-only --diff-filter=A develop...HEAD')
      );
    });

    it('logVsMaster uses configured baseBranch', async () => {
      mockExec.mockResolvedValueOnce({
        stdout: 'abc123 Some commit\n',
        stderr: '',
        exitCode: 0,
      });

      const result = await customGit.logVsMaster();

      expect(result).toContain('Some commit');
      expect(mockExec).toHaveBeenCalledTimes(1);
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('log develop..HEAD --oneline')
      );
    });

    it('changedFilesCountVsMaster uses configured baseBranch', async () => {
      mockExec.mockResolvedValueOnce({
        stdout: 'src/a.ts\nsrc/b.ts\n',
        stderr: '',
        exitCode: 0,
      });

      const result = await customGit.changedFilesCountVsMaster();

      expect(result).toBe(2);
      expect(mockExec).toHaveBeenCalledTimes(1);
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('diff --name-only develop...HEAD')
      );
    });

    it('diffLinesVsMaster uses configured baseBranch', async () => {
      mockExec.mockResolvedValueOnce({
        stdout: ' src/file1.ts | 10 ++++++++++\n 1 file changed, 10 insertions(+)\n',
        stderr: '',
        exitCode: 0,
      });

      const result = await customGit.diffLinesVsMaster();

      expect(result).toBe(10);
      expect(mockExec).toHaveBeenCalledTimes(1);
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('diff --stat develop...HEAD')
      );
    });

    it('setBaseBranch updates the base branch at runtime', async () => {
      const dynamicGit = new GitService(projectRoot);
      dynamicGit.setBaseBranch('release');

      mockExec.mockResolvedValueOnce({
        stdout: '2\n',
        stderr: '',
        exitCode: 0,
      });

      const result = await dynamicGit.commitCountVsMaster();

      expect(result).toBe(2);
      expect(mockExec).toHaveBeenCalledTimes(1);
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('rev-list --count release..HEAD')
      );
    });
  });
});
