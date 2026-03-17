import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { autoCommitRigState } from '../../src/utils/git.js';
import { exec } from '../../src/utils/shell.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdir, writeFile, rm } from 'fs/promises';

vi.mock('../../src/utils/shell.js', () => ({
  exec: vi.fn(),
}));

const mockExec = vi.mocked(exec);

describe('autoCommitRigState', () => {
  const testRoot = join(tmpdir(), 'rig-cli-git-test-' + Date.now());

  beforeEach(() => {
    mockExec.mockReset();
  });

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true });
  });

  it('commits .rig-state.json when it has changes', async () => {
    mockExec
      .mockResolvedValueOnce({ stdout: '.git', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'Test User', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'test@example.com', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'ref: refs/heads/main', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'M .rig-state.json', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '.rig-state.json', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '[main abc123] chore: update .rig-state after review', stderr: '', exitCode: 0 });

    const result = await autoCommitRigState(testRoot);

    expect(result.committed).toBe(true);
    expect(result.message).toBeUndefined();
    expect(mockExec).toHaveBeenCalledWith(expect.stringContaining('git -C'));
    expect(mockExec).toHaveBeenCalledWith(expect.stringContaining('add .rig-state.json'));
    expect(mockExec).toHaveBeenCalledWith(expect.stringContaining('commit -m "chore: update .rig-state after review"'));
  });

  it('returns no-op when .rig-state.json is unchanged', async () => {
    mockExec
      .mockResolvedValueOnce({ stdout: '.git', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'Test User', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'test@example.com', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'ref: refs/heads/main', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 });

    const result = await autoCommitRigState(testRoot);

    expect(result.committed).toBe(false);
    expect(result.message).toBeUndefined();
    expect(mockExec).not.toHaveBeenCalledWith(expect.stringContaining('add'));
  });

  it('throws error when git is not initialized', async () => {
    mockExec.mockResolvedValueOnce({
      stdout: '',
      stderr: 'fatal: not a git repository',
      exitCode: 128
    });

    await expect(autoCommitRigState(testRoot)).rejects.toThrow('Git repository not initialized');
  });

  it('throws error when git user.name is not configured', async () => {
    mockExec
      .mockResolvedValueOnce({ stdout: '.git', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 1 });

    await expect(autoCommitRigState(testRoot)).rejects.toThrow('Git user.name not configured');
  });

  it('throws error when git user.email is not configured', async () => {
    mockExec
      .mockResolvedValueOnce({ stdout: '.git', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'Test User', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 1 });

    await expect(autoCommitRigState(testRoot)).rejects.toThrow('Git user.email not configured');
  });

  it('throws error when repository is in detached HEAD state', async () => {
    mockExec
      .mockResolvedValueOnce({ stdout: '.git', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'Test User', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'test@example.com', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 1 });

    await expect(autoCommitRigState(testRoot)).rejects.toThrow('detached HEAD state');
  });

  it('warns when .rig-state.json is in .gitignore (add fails)', async () => {
    mockExec
      .mockResolvedValueOnce({ stdout: '.git', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'Test User', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'test@example.com', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'ref: refs/heads/main', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'M .rig-state.json', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({
        stdout: '',
        stderr: 'The following paths are ignored by one of your .gitignore files',
        exitCode: 1
      });

    const result = await autoCommitRigState(testRoot);

    expect(result.committed).toBe(false);
    expect(result.message).toContain('is in .gitignore');
    expect(result.message).toContain('will not be committed');
  });

  it('warns when .rig-state.json is in .gitignore (staging succeeds but no cached diff)', async () => {
    mockExec
      .mockResolvedValueOnce({ stdout: '.git', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'Test User', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'test@example.com', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'ref: refs/heads/main', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'M .rig-state.json', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 });

    const result = await autoCommitRigState(testRoot);

    expect(result.committed).toBe(false);
    expect(result.message).toContain('could not be staged');
    expect(result.message).toContain('likely in .gitignore');
  });

  it('handles git status failure gracefully', async () => {
    mockExec
      .mockResolvedValueOnce({ stdout: '.git', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'Test User', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'test@example.com', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'ref: refs/heads/main', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({
        stdout: '',
        stderr: 'fatal: git status failed',
        exitCode: 1
      });

    await expect(autoCommitRigState(testRoot)).rejects.toThrow('Failed to check git status');
  });

  it('handles commit failure gracefully', async () => {
    mockExec
      .mockResolvedValueOnce({ stdout: '.git', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'Test User', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'test@example.com', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'ref: refs/heads/main', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'M .rig-state.json', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '.rig-state.json', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({
        stdout: '',
        stderr: 'fatal: commit failed',
        exitCode: 1
      });

    await expect(autoCommitRigState(testRoot)).rejects.toThrow('Failed to commit');
  });

  it('returns no-op when commit says nothing to commit', async () => {
    mockExec
      .mockResolvedValueOnce({ stdout: '.git', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'Test User', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'test@example.com', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'ref: refs/heads/main', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'M .rig-state.json', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '.rig-state.json', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({
        stdout: 'nothing to commit, working tree clean',
        stderr: '',
        exitCode: 1
      });

    const result = await autoCommitRigState(testRoot);

    expect(result.committed).toBe(false);
    expect(result.message).toBeUndefined();
  });

  it('only stages .rig-state.json and not other files', async () => {
    mockExec
      .mockResolvedValueOnce({ stdout: '.git', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'Test User', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'test@example.com', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'ref: refs/heads/main', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'M .rig-state.json', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '.rig-state.json', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '[main abc123] chore: update .rig-state after review', stderr: '', exitCode: 0 });

    await autoCommitRigState(testRoot);

    const addCall = mockExec.mock.calls.find(call =>
      call[0].includes('add .rig-state.json')
    );
    expect(addCall).toBeDefined();
    expect(addCall![0]).toEqual(expect.stringMatching(/git -C .* add \.rig-state\.json$/));
    expect(addCall![0]).not.toContain('add -A');
  });
});
