import { fileExists } from './file.js';
import * as path from 'path';

/**
 * Supported package managers.
 */
export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun';

/**
 * Detects the package manager used in a project by checking for lock files.
 *
 * Detection order:
 * 1. yarn.lock -> yarn
 * 2. pnpm-lock.yaml -> pnpm
 * 3. bun.lockb -> bun
 * 4. package-lock.json -> npm
 * 5. default -> npm
 *
 * @param projectPath - Path to the project directory
 * @returns The detected package manager
 */
export async function detectPackageManager(projectPath: string): Promise<PackageManager> {
  const pnpmLock = path.join(projectPath, 'pnpm-lock.yaml');
  const yarnLock = path.join(projectPath, 'yarn.lock');
  const bunLock = path.join(projectPath, 'bun.lockb');
  const npmLock = path.join(projectPath, 'package-lock.json');

  if (await fileExists(yarnLock)) {
    return 'yarn';
  }

  if (await fileExists(pnpmLock)) {
    return 'pnpm';
  }

  if (await fileExists(bunLock)) {
    return 'bun';
  }

  if (await fileExists(npmLock)) {
    return 'npm';
  }

  return 'npm';
}

/**
 * Gets the install command for a package manager.
 *
 * @param pm - Package manager
 * @param packages - Packages to install
 * @param dev - Whether to install as dev dependencies
 * @returns The install command
 */
export function getInstallCommand(pm: PackageManager, packages: string, dev = true): string {
  switch (pm) {
    case 'pnpm':
      return dev ? `pnpm add -D ${packages}` : `pnpm add ${packages}`;
    case 'yarn':
      return dev ? `yarn add -D ${packages}` : `yarn add ${packages}`;
    case 'bun':
      return dev ? `bun add -d ${packages}` : `bun add ${packages}`;
    case 'npm':
    default:
      return dev ? `npm install --save-dev ${packages}` : `npm install ${packages}`;
  }
}

/**
 * Gets the run command for a package manager script.
 *
 * @param pm - Package manager
 * @param script - Script name
 * @returns The run command
 */
export function getRunCommand(pm: PackageManager, script: string): string {
  switch (pm) {
    case 'pnpm':
      return `pnpm ${script}`;
    case 'yarn':
      return `yarn ${script}`;
    case 'bun':
      return `bun ${script}`;
    case 'npm':
    default:
      return `npm ${script === 'test' ? 'test' : `run ${script}`}`;
  }
}
