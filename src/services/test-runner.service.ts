import { exec } from '../utils/shell.js';
import { GitService } from './git.service.js';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { readFile } from 'fs/promises';

/**
 * TestResult represents the outcome of a test run.
 */
export interface TestResult {
  success: boolean;
  output: string;
  skipped?: boolean;
}

/**
 * TestRunnerService orchestrates test execution for different project components.
 *
 * Runs lint, build, and test commands for backend (Go), frontend (TypeScript/React),
 * and devnet components. Includes test coverage checking to ensure new source files
 * have corresponding test files.
 */
export class TestRunnerService {
  private projectRoot: string;
  private git: GitService;

  /**
   * Creates a new TestRunnerService instance.
   *
   * @param projectRoot - Absolute path to the project root directory
   * @param git - GitService for git operations
   */
  constructor(projectRoot: string, git: GitService) {
    this.projectRoot = projectRoot;
    this.git = git;
  }

  /**
   * Runs backend linting (golangci-lint or go vet).
   *
   * Attempts to auto-fix issues first, stages changes, then verifies.
   * Falls back to `go vet` if golangci-lint is not available.
   *
   * @returns Test result with success status and output
   */
  async runBackendLint(): Promise<TestResult> {
    const backendDir = resolve(this.projectRoot, 'backend');

    if (!existsSync(backendDir)) {
      return { success: true, output: '', skipped: true };
    }

    // Check if golangci-lint is available
    const lintCheck = await exec('which golangci-lint');

    if (lintCheck.exitCode === 0) {
      // Try auto-fix first
      await exec(`cd "${backendDir}" && golangci-lint run --fix ./...`);

      // Stage fixes
      await exec(`cd "${this.projectRoot}" && git add -A backend/`);

      // Verify it passes
      const result = await exec(`cd "${backendDir}" && golangci-lint run ./...`);

      return {
        success: result.exitCode === 0,
        output: result.stdout + result.stderr,
      };
    } else {
      // Fall back to go vet
      const result = await exec(`cd "${backendDir}" && go vet ./...`);

      return {
        success: result.exitCode === 0,
        output: result.stdout + result.stderr,
      };
    }
  }

  /**
   * Runs backend build check.
   *
   * Executes `go build ./...` to verify all backend code compiles.
   *
   * @returns Test result with success status and output
   */
  async runBackendBuild(): Promise<TestResult> {
    const backendDir = resolve(this.projectRoot, 'backend');

    if (!existsSync(backendDir)) {
      return { success: true, output: '', skipped: true };
    }

    const result = await exec(`cd "${backendDir}" && go build ./...`);

    return {
      success: result.exitCode === 0,
      output: result.stdout + result.stderr,
    };
  }

  /**
   * Runs backend tests.
   *
   * Executes `go test ./... -v` to run all backend tests.
   *
   * @returns Test result with success status and output
   */
  async runBackendTests(): Promise<TestResult> {
    const backendDir = resolve(this.projectRoot, 'backend');

    if (!existsSync(backendDir)) {
      return { success: true, output: '', skipped: true };
    }

    const result = await exec(`cd "${backendDir}" && go test ./... -v`);

    return {
      success: result.exitCode === 0,
      output: result.stdout + result.stderr,
    };
  }

  /**
   * Runs frontend linting.
   *
   * Attempts to auto-fix with `eslint --fix`, stages changes, then runs `npm run lint`.
   *
   * @returns Test result with success status and output
   */
  async runFrontendLint(): Promise<TestResult> {
    const frontendDir = resolve(this.projectRoot, 'frontend');

    if (!existsSync(frontendDir)) {
      return { success: true, output: '', skipped: true };
    }

    // Try auto-fix first
    await exec(`cd "${frontendDir}" && npx eslint --fix src/`);

    // Stage fixes
    await exec(`cd "${this.projectRoot}" && git add -A frontend/src/`);

    // Verify it passes
    const result = await exec(`cd "${frontendDir}" && npm run lint`);

    return {
      success: result.exitCode === 0,
      output: result.stdout + result.stderr,
    };
  }

  /**
   * Runs frontend build check.
   *
   * Executes `npm run build` to verify frontend builds successfully.
   *
   * @returns Test result with success status and output
   */
  async runFrontendBuild(): Promise<TestResult> {
    const frontendDir = resolve(this.projectRoot, 'frontend');

    if (!existsSync(frontendDir)) {
      return { success: true, output: '', skipped: true };
    }

    const result = await exec(`cd "${frontendDir}" && npm run build`);

    return {
      success: result.exitCode === 0,
      output: result.stdout + result.stderr,
    };
  }

  /**
   * Runs frontend tests.
   *
   * Checks if test script exists in package.json, then runs `npm test`.
   *
   * @returns Test result with success status and output
   */
  async runFrontendTests(): Promise<TestResult> {
    const frontendDir = resolve(this.projectRoot, 'frontend');

    if (!existsSync(frontendDir)) {
      return { success: true, output: '', skipped: true };
    }

    // Check if test script exists
    const packageJsonPath = resolve(frontendDir, 'package.json');
    if (!existsSync(packageJsonPath)) {
      return {
        success: true,
        output: 'No package.json found',
        skipped: true,
      };
    }

    try {
      const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf-8'));
      if (!packageJson.scripts?.test) {
        return {
          success: true,
          output: 'No test script in package.json',
          skipped: true,
        };
      }
    } catch {
      return {
        success: true,
        output: 'Could not read package.json',
        skipped: true,
      };
    }

    const result = await exec(`cd "${frontendDir}" && npm test`);

    return {
      success: result.exitCode === 0,
      output: result.stdout + result.stderr,
    };
  }

  /**
   * Runs devnet tests.
   *
   * Checks if devnet directory exists and runs `npx vitest run`.
   *
   * @returns Test result with success status and output
   */
  async runDevnetTests(): Promise<TestResult> {
    const devnetDir = resolve(this.projectRoot, 'devnet');

    if (!existsSync(devnetDir)) {
      return { success: true, output: '', skipped: true };
    }

    const packageJsonPath = resolve(devnetDir, 'package.json');
    if (!existsSync(packageJsonPath)) {
      return {
        success: true,
        output: 'No devnet/package.json found',
        skipped: true,
      };
    }

    const result = await exec(`cd "${devnetDir}" && npx vitest run`);

    return {
      success: result.exitCode === 0,
      output: result.stdout + result.stderr,
    };
  }

  /**
   * Runs all tests for a given component.
   *
   * Orchestrates lint, build, and test runs based on component type.
   * - backend: lint → build → tests
   * - frontend: lint → build → tests
   * - devnet: devnet tests only
   * - fullstack: backend + frontend
   *
   * @param component - Component type to test
   * @returns Test result with success status and combined output
   */
  async runAllTests(component: 'backend' | 'frontend' | 'devnet' | 'fullstack'): Promise<TestResult> {
    const results: TestResult[] = [];

    if (component === 'devnet') {
      results.push(await this.runDevnetTests());
      results.push(await this.checkTestCoverage(component));
    } else {
      if (component === 'backend' || component === 'fullstack') {
        results.push(await this.runBackendLint());
        results.push(await this.runBackendBuild());
        results.push(await this.runBackendTests());
      }

      if (component === 'frontend' || component === 'fullstack') {
        results.push(await this.runFrontendLint());
        results.push(await this.runFrontendBuild());
        results.push(await this.runFrontendTests());
      }

      results.push(await this.checkTestCoverage(component));
    }

    // Aggregate results
    const success = results.every(r => r.success);
    const output = results.map(r => r.output).filter(o => o.length > 0).join('\n\n');

    return { success, output };
  }

  /**
   * Checks that new source files have corresponding test files.
   *
   * Verifies test coverage for new files added in the current branch:
   * - Go files (*.go) must have adjacent *_test.go files
   * - TypeScript files (*.ts, *.tsx) must have .test.ts or .test.tsx files
   *
   * Skips: test files, configs, migrations, assets, type definitions
   *
   * @param _component - Component being tested (reserved for future use)
   * @returns Test result indicating if all new files have tests
   */
  async checkTestCoverage(_component: string): Promise<TestResult> {
    // Get new files added in this branch
    const newFiles = await this.git.newFilesVsMaster();

    if (newFiles.length === 0) {
      return { success: true, output: 'No new files added' };
    }

    const missingTests: string[] = [];

    for (const file of newFiles) {
      // Skip test files themselves
      if (this.isTestFile(file)) {
        continue;
      }

      // Skip config, migrations, assets, etc.
      if (this.shouldSkipFile(file)) {
        continue;
      }

      // Check Go files
      if (file.endsWith('.go')) {
        const testFile = file.replace(/\.go$/, '_test.go');
        if (!newFiles.includes(testFile) && !existsSync(resolve(this.projectRoot, testFile))) {
          missingTests.push(`${file} → expected ${testFile}`);
        }
      }

      // Check TypeScript/React files
      if (file.endsWith('.ts') || file.endsWith('.tsx')) {
        // Skip type definitions
        if (file.endsWith('.d.ts') || file.includes('/types/')) {
          continue;
        }

        const base = file.substring(0, file.lastIndexOf('.'));
        const ext = file.substring(file.lastIndexOf('.'));
        const testFile = `${base}.test${ext}`;

        if (!newFiles.includes(testFile) && !existsSync(resolve(this.projectRoot, testFile))) {
          missingTests.push(`${file} → expected ${testFile}`);
        }
      }
    }

    if (missingTests.length > 0) {
      const output = `New source files without corresponding test files:\n${missingTests.map(mt => `  ${mt}`).join('\n')}`;
      return { success: false, output };
    }

    return { success: true, output: 'All new source files have test coverage' };
  }

  /**
   * Lists new test files added in the current branch.
   *
   * @returns Array of test file paths
   */
  async listNewTestFiles(): Promise<string[]> {
    const newFiles = await this.git.newFilesVsMaster();
    return newFiles.filter(f => this.isTestFile(f));
  }

  /**
   * Checks if a file is a test file.
   *
   * @private
   * @param file - File path to check
   * @returns true if file is a test file
   */
  private isTestFile(file: string): boolean {
    return (
      file.endsWith('_test.go') ||
      file.endsWith('.test.ts') ||
      file.endsWith('.test.tsx') ||
      file.endsWith('.spec.ts') ||
      file.endsWith('.spec.tsx') ||
      file.includes('/test/') ||
      file.includes('/__tests__/') ||
      file.includes('/testutil/')
    );
  }

  /**
   * Checks if a file should be skipped for test coverage checks.
   *
   * @private
   * @param file - File path to check
   * @returns true if file should be skipped
   */
  private shouldSkipFile(file: string): boolean {
    // Skip by extension
    const skipExtensions = ['.md', '.yml', '.yaml', '.json', '.sql', '.css', '.svg', '.png'];
    if (skipExtensions.some(ext => file.endsWith(ext))) {
      return true;
    }

    // Skip by path patterns
    const skipPatterns = [
      '/migrations/',
      '/sql/',
      '/.hf',
      '/bin/',
      '/.github/',
      '.config.ts',
      '.config.tsx',
      '.config.js',
      '/setup.',
    ];

    return skipPatterns.some(pattern => file.includes(pattern));
  }
}
