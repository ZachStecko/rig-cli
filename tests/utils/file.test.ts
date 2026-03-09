import { describe, it, expect, afterEach } from 'vitest';
import { fileExists, readFileIfExists, ensureDir } from '../../src/utils/file.js';
import { writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const TMP = join(tmpdir(), 'rig-cli-test-' + Date.now());

afterEach(async () => {
  await rm(TMP, { recursive: true, force: true });
});

describe('fileExists', () => {
  it('returns true for existing file', async () => {
    await ensureDir(TMP);
    const p = join(TMP, 'test.txt');
    await writeFile(p, 'hi');
    expect(await fileExists(p)).toBe(true);
  });

  it('returns false for missing file', async () => {
    expect(await fileExists(join(TMP, 'nope.txt'))).toBe(false);
  });
});

describe('readFileIfExists', () => {
  it('reads existing file', async () => {
    await ensureDir(TMP);
    const p = join(TMP, 'read.txt');
    await writeFile(p, 'content');
    expect(await readFileIfExists(p)).toBe('content');
  });

  it('returns null for missing file', async () => {
    expect(await readFileIfExists(join(TMP, 'nope.txt'))).toBeNull();
  });
});

describe('ensureDir', () => {
  it('creates nested directories', async () => {
    const nested = join(TMP, 'a', 'b', 'c');
    await ensureDir(nested);
    expect(await fileExists(nested)).toBe(true);
  });
});
