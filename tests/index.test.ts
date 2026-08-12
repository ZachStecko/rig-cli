import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');

describe('CLI entry point', () => {
  it('src/index.ts exists', () => {
    expect(existsSync(resolve(ROOT, 'src/index.ts'))).toBe(true);
  });

  it('--help prints description', () => {
    const out = execSync('npx tsx src/index.ts --help', { cwd: ROOT, encoding: 'utf-8' });
    expect(out).toContain('AI-assisted GitHub issue creation and PR opening');
  });

  it('--help lists exactly the four commands', () => {
    const out = execSync('npx tsx src/index.ts --help', { cwd: ROOT, encoding: 'utf-8' });
    for (const cmd of ['create-issue', 'story', 'pr', 'setup-labels']) {
      expect(out).toContain(cmd);
    }
    for (const cmd of ['ship', 'implement', 'rollback', 'queue', 'bootstrap', 'review']) {
      expect(out).not.toMatch(new RegExp(`^\\s+${cmd}\\b`, 'm'));
    }
  });
});
