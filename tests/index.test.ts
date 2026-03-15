import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');

describe('CLI entry point', () => {
  it('src/index.ts exists', () => {
    expect(existsSync(resolve(ROOT, 'src/index.ts'))).toBe(true);
  });

  it('--version prints version', () => {
    const out = execSync('npx tsx src/index.ts --version', { cwd: ROOT, encoding: 'utf-8' });
    expect(out.trim()).toBe('0.1.1');
  });

  it('--help prints description', () => {
    const out = execSync('npx tsx src/index.ts --help', { cwd: ROOT, encoding: 'utf-8' });
    expect(out).toContain('Automated issue-to-PR pipeline');
  });
});
