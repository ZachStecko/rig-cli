import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GitService } from '../../src/services/git.service.js';
import * as shell from '../../src/utils/shell.js';
import * as fs from 'fs';

// Mock the shell module
vi.mock('../../src/utils/shell.js', () => ({
  exec: vi.fn(),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return {
    ...actual,
    mkdtempSync: vi.fn().mockReturnValue('/tmp/rig-commit-abc123'),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

describe('GitService', () => {
  let gitService: GitService;
  const projectRoot = '/test/project';
  const mockExec = vi.mocked(shell.exec);

  beforeEach(() => {
    gitService = new GitService(projectRoot);
    mockExec.mockClear();
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

  describe('getBaseBranchName', () => {
    it('returns main when main branch exists', async () => {
      mockExec.mockResolvedValueOnce({ stdout: 'abc123\n', stderr: '', exitCode: 0 });

      const result = await gitService.getBaseBranchName();

      expect(result).toBe('main');
    });

    it('returns master when main does not exist but master does', async () => {
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: 'fatal', exitCode: 128 });
      mockExec.mockResolvedValueOnce({ stdout: 'def456\n', stderr: '', exitCode: 0 });

      const result = await gitService.getBaseBranchName();

      expect(result).toBe('master');
    });

    it('throws when neither main nor master exists', async () => {
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: 'fatal', exitCode: 128 });
      mockExec.mockResolvedValueOnce({ stdout: '', stderr: 'fatal', exitCode: 128 });

      await expect(gitService.getBaseBranchName()).rejects.toThrow('Neither "main" nor "master" branch found');
    });

    it('returns configured baseBranch without auto-detection', async () => {
      const customGit = new GitService(projectRoot, 'develop');

      const result = await customGit.getBaseBranchName();

      expect(result).toBe('develop');
      expect(mockExec).not.toHaveBeenCalled();
    });
  });

  describe('branchExists', () => {
    it('returns true when the branch exists', async () => {
      mockExec.mockResolvedValue({ stdout: 'abc123\n', stderr: '', exitCode: 0 });

      expect(await gitService.branchExists('issue-21-fix')).toBe(true);
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('rev-parse --verify --quiet refs/heads/issue-21-fix')
      );
    });

    it('returns false when the branch does not exist', async () => {
      mockExec.mockResolvedValue({ stdout: '', stderr: '', exitCode: 1 });

      expect(await gitService.branchExists('issue-21-fix')).toBe(false);
    });

    it('rejects invalid branch names', async () => {
      await expect(gitService.branchExists('bad name; rm -rf')).rejects.toThrow('Invalid branch name');
      expect(mockExec).not.toHaveBeenCalled();
    });
  });

  describe('listBranches', () => {
    it('returns matching branch names', async () => {
      mockExec.mockResolvedValue({
        stdout: 'issue-21-add-clipboard\nissue-21-old-attempt\n',
        stderr: '',
        exitCode: 0,
      });

      const result = await gitService.listBranches('issue-21-*');

      expect(result).toEqual(['issue-21-add-clipboard', 'issue-21-old-attempt']);
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('branch --list "issue-21-*"')
      );
    });

    it('returns an empty array when nothing matches', async () => {
      mockExec.mockResolvedValue({ stdout: '\n', stderr: '', exitCode: 0 });

      expect(await gitService.listBranches('issue-99-*')).toEqual([]);
    });

    it('rejects invalid patterns', async () => {
      await expect(gitService.listBranches('bad pattern; rm')).rejects.toThrow('Invalid branch pattern');
      expect(mockExec).not.toHaveBeenCalled();
    });
  });

  describe('checkout', () => {
    it('checks out the branch', async () => {
      mockExec.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

      await gitService.checkout('issue-21-fix');

      expect(mockExec).toHaveBeenCalledWith(expect.stringContaining('checkout issue-21-fix'));
    });

    it('throws when checkout fails', async () => {
      mockExec.mockResolvedValue({ stdout: '', stderr: 'conflict', exitCode: 1 });

      await expect(gitService.checkout('issue-21-fix')).rejects.toThrow('Git command failed');
    });
  });

  describe('createBranch', () => {
    it('branches off origin when the fetch succeeds', async () => {
      mockExec.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

      await gitService.createBranch('issue-21-fix', 'master');

      expect(mockExec).toHaveBeenCalledWith(expect.stringContaining('fetch origin master'));
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('checkout --no-track -b issue-21-fix origin/master')
      );
    });

    it('falls back to the local ref when the fetch fails', async () => {
      mockExec
        .mockResolvedValueOnce({ stdout: '', stderr: 'no remote', exitCode: 1 })
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 });

      await gitService.createBranch('issue-21-fix', 'master');

      expect(mockExec).toHaveBeenLastCalledWith(
        expect.stringContaining('checkout --no-track -b issue-21-fix master')
      );
    });

    it('rejects invalid branch names', async () => {
      await expect(gitService.createBranch('bad name', 'master')).rejects.toThrow('Invalid branch name');
      expect(mockExec).not.toHaveBeenCalled();
    });
  });

  describe('configured baseBranch', () => {
    let customGit: GitService;

    beforeEach(() => {
      customGit = new GitService(projectRoot, 'develop');
      mockExec.mockClear();
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

    it('setBaseBranch updates the base branch at runtime', async () => {
      const dynamicGit = new GitService(projectRoot);
      dynamicGit.setBaseBranch('release');

      mockExec.mockResolvedValueOnce({
        stdout: 'abc123 Some commit\n',
        stderr: '',
        exitCode: 0,
      });

      await dynamicGit.logVsMaster();

      expect(mockExec).toHaveBeenCalledTimes(1);
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('log release..HEAD --oneline')
      );
    });
  });
});
