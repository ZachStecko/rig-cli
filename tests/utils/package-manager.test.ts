import { describe, it, expect, afterEach } from 'vitest';
import { detectPackageManager, getInstallCommand, getRunCommand } from '../../src/utils/package-manager.js';
import { writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ensureDir } from '../../src/utils/file.js';

const TMP = join(tmpdir(), 'rig-cli-pm-test-' + Date.now());

afterEach(async () => {
  await rm(TMP, { recursive: true, force: true });
});

describe('detectPackageManager', () => {
  it('detects pnpm from pnpm-lock.yaml', async () => {
    await ensureDir(TMP);
    await writeFile(join(TMP, 'pnpm-lock.yaml'), '');
    expect(await detectPackageManager(TMP)).toBe('pnpm');
  });

  it('detects yarn from yarn.lock', async () => {
    await ensureDir(TMP);
    await writeFile(join(TMP, 'yarn.lock'), '');
    expect(await detectPackageManager(TMP)).toBe('yarn');
  });

  it('detects npm from package-lock.json', async () => {
    await ensureDir(TMP);
    await writeFile(join(TMP, 'package-lock.json'), '');
    expect(await detectPackageManager(TMP)).toBe('npm');
  });

  it('prefers pnpm when multiple lock files exist', async () => {
    await ensureDir(TMP);
    await writeFile(join(TMP, 'pnpm-lock.yaml'), '');
    await writeFile(join(TMP, 'yarn.lock'), '');
    await writeFile(join(TMP, 'package-lock.json'), '');
    expect(await detectPackageManager(TMP)).toBe('pnpm');
  });

  it('prefers yarn over npm when both exist', async () => {
    await ensureDir(TMP);
    await writeFile(join(TMP, 'yarn.lock'), '');
    await writeFile(join(TMP, 'package-lock.json'), '');
    expect(await detectPackageManager(TMP)).toBe('yarn');
  });

  it('defaults to npm when no lock files exist', async () => {
    await ensureDir(TMP);
    expect(await detectPackageManager(TMP)).toBe('npm');
  });
});

describe('getInstallCommand', () => {
  it('returns npm install command for npm', () => {
    expect(getInstallCommand('npm', 'vitest', true)).toBe('npm install --save-dev vitest');
  });

  it('returns yarn add command for yarn', () => {
    expect(getInstallCommand('yarn', 'vitest', true)).toBe('yarn add -D vitest');
  });

  it('returns pnpm add command for pnpm', () => {
    expect(getInstallCommand('pnpm', 'vitest', true)).toBe('pnpm add -D vitest');
  });

  it('returns production install for npm when dev is false', () => {
    expect(getInstallCommand('npm', 'express', false)).toBe('npm install express');
  });

  it('returns production install for yarn when dev is false', () => {
    expect(getInstallCommand('yarn', 'express', false)).toBe('yarn add express');
  });

  it('returns production install for pnpm when dev is false', () => {
    expect(getInstallCommand('pnpm', 'express', false)).toBe('pnpm add express');
  });

  it('handles multiple packages', () => {
    expect(getInstallCommand('npm', 'vitest @testing-library/react', true)).toBe(
      'npm install --save-dev vitest @testing-library/react'
    );
  });
});

describe('getRunCommand', () => {
  it('returns npm run command for npm', () => {
    expect(getRunCommand('npm', 'build')).toBe('npm run build');
  });

  it('returns npm test for test script with npm', () => {
    expect(getRunCommand('npm', 'test')).toBe('npm test');
  });

  it('returns yarn command for yarn', () => {
    expect(getRunCommand('yarn', 'build')).toBe('yarn build');
  });

  it('returns yarn test for test script with yarn', () => {
    expect(getRunCommand('yarn', 'test')).toBe('yarn test');
  });

  it('returns pnpm command for pnpm', () => {
    expect(getRunCommand('pnpm', 'build')).toBe('pnpm build');
  });

  it('returns pnpm test for test script with pnpm', () => {
    expect(getRunCommand('pnpm', 'test')).toBe('pnpm test');
  });
});
