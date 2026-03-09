import { describe, it, expect } from 'vitest';
import { exec } from '../../src/utils/shell.js';

describe('exec', () => {
  it('returns stdout for successful command', async () => {
    const result = await exec('echo hello');
    expect(result.stdout.trim()).toBe('hello');
    expect(result.exitCode).toBe(0);
  });

  it('returns non-zero exitCode for failed command', async () => {
    const result = await exec('exit 1');
    expect(result.exitCode).not.toBe(0);
  });

  it('captures stderr', async () => {
    const result = await exec('echo err >&2');
    expect(result.stderr.trim()).toBe('err');
  });
});
