import { exec } from '../utils/shell.js';
import { GitService } from './git.service.js';
import { ConfigManager } from './config-manager.service.js';
import { Logger } from './logger.service.js';
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
  /** Label identifying which step produced this result (e.g., "Frontend lint") */
  step?: string;
}

/**
 * Aggregated result from runAllTests, including per-step breakdown.
 */
export interface AggregateTestResult extends TestResult {
  /** All individual step results */
  steps: TestResult[];
  /** Only the steps that failed (non-skipped) */
  failedSteps: TestResult[];
}

/**
 * TestRunnerService orchestrates test execution for different project components.
 *
 * Runs lint, build, and test commands for backend (Go/TypeScript), frontend (TypeScript/React),
 * and devnet components. Reads component configuration from .rig.yml instead of hardcoding paths.
 * Includes test coverage checking to ensure new source files have corresponding test files.
 */
export class TestRunnerService {
  private projectRoot: string;
  private git: GitService;
  private config: ConfigManager;
  private logger: Logger;

  /**
   * Allowed command prefixes for security validation.
   * Commands must start with one of these to prevent arbitrary code execution.
   */
  private readonly ALLOWED_COMMANDS = [
    'go test',
    'go build',
    'go vet',
    'golangci-lint',
    'npm test',
    'npm run test',
    'npm run build',
    'npm run lint',
    'npx vitest',
    'npx eslint',
    'pytest',
    'python -m pytest',
    'cargo test',
    'cargo build',
    'cargo clippy',
    'terraform validate',
    'terraform plan',
  ];

  /**
   * Creates a new TestRunnerService instance.
   *
   * @param projectRoot - Absolute path to the project root directory
   * @param git - GitService for git operations
   * @param config - ConfigManager for reading component configuration
   * @param logger - Logger for verbose output
   */
  constructor(projectRoot: string, git: GitService, config: ConfigManager, logger: Logger) {
    this.projectRoot = projectRoot;
    this.git = git;
    this.config = config;
    this.logger = logger;
  }

  /**
   * Validates that a command is safe to execute.
   * Prevents shell injection by checking against whitelist of allowed commands.
   *
   * @param command - Command to validate
   * @throws Error if command is not in whitelist
   */
  private validateCommand(command: string): void {
    const trimmed = command.trim();
    const isAllowed = this.ALLOWED_COMMANDS.some(allowed => trimmed.startsWith(allowed));

    if (!isAllowed) {
      throw new Error(
        `Unsafe command rejected: "${command}". ` +
        `Allowed commands must start with: ${this.ALLOWED_COMMANDS.join(', ')}`
      );
    }
  }

  /**
   * Validates that a path is safe (no directory traversal or shell metacharacters).
   *
   * @param path - Path to validate
   * @throws Error if path contains dangerous characters
   */
  private validatePath(path: string): void {
    if (path.includes('..')) {
      throw new Error(`Invalid path: "${path}" contains directory traversal`);
    }

    // Check for shell metacharacters that could enable injection
    const dangerousChars = [';', '&', '|', '$', '`', '"', "'", '\n', '\r'];
    for (const char of dangerousChars) {
      if (path.includes(char)) {
        throw new Error(`Invalid path: "${path}" contains dangerous character: ${char}`);
      }
    }
  }

  /**
   * Runs backend linting.
   *
   * Uses lint_command from component config if available.
   * For Go backends without explicit lint_command, auto-detects golangci-lint or go vet.
   * For TypeScript backends, uses npm run lint.
   *
   * @returns Test result with success status and output
   */
  async runBackendLint(): Promise<TestResult> {
    const rigConfig = this.config.get();
    const backendConfig = rigConfig.components?.backend;

    if (!backendConfig) {
      return { success: true, output: 'Backend not configured', skipped: true };
    }

    // Validate path for security
    this.validatePath(backendConfig.path);

    const backendDir = resolve(this.projectRoot, backendConfig.path);

    if (!existsSync(backendDir)) {
      return { success: true, output: '', skipped: true };
    }

    let lintCommand = backendConfig.lint_command;

    // Auto-detect lint command if not specified
    if (!lintCommand) {
      // Check if this is a Go backend (has go.mod)
      const goModExists = existsSync(resolve(backendDir, 'go.mod'));
      if (goModExists) {
        const lintCheck = await exec('which golangci-lint');
        lintCommand = lintCheck.exitCode === 0 ? 'golangci-lint run ./...' : 'go vet ./...';
      } else {
        // Check for Python backend (has requirements.txt or setup.py)
        const pythonExists = existsSync(resolve(backendDir, 'requirements.txt')) ||
                            existsSync(resolve(backendDir, 'setup.py'));
        if (pythonExists) {
          lintCommand = 'python -m pylint .';
        } else {
          // Assume npm-based (TypeScript, etc.)
          lintCommand = 'npm run lint';
        }
      }
    }

    // Validate command for security
    this.validateCommand(lintCommand);

    this.logger.config('Backend directory', backendConfig.path);
    this.logger.config('Lint command', lintCommand);

    const startTime = Date.now();

    // Try auto-fix first if available
    if (lintCommand.includes('golangci-lint')) {
      await exec(`cd "${backendDir}" && golangci-lint run --fix ./...`);
      await exec(`cd "${this.projectRoot}" && git add -A ${backendConfig.path}/`);
    } else if (lintCommand.includes('eslint') || lintCommand === 'npm run lint') {
      await exec(`cd "${backendDir}" && npx eslint --fix src/`);
      await exec(`cd "${this.projectRoot}" && git add -A ${backendConfig.path}/src/`);
    }

    // Use eslint --quiet for npm-based linting to suppress warnings
    const lintCmd = lintCommand === 'npm run lint'
      ? 'npx eslint --quiet src/'
      : lintCommand;
    const result = await exec(`cd "${backendDir}" && ${lintCmd}`);
    const elapsed = Date.now() - startTime;

    this.logger.timing('Backend lint', elapsed);

    // Treat warnings as non-fatal: only fail if output contains "Error" lines
    const combinedOutput = result.stdout + result.stderr;
    const hasErrors = this.lintOutputHasErrors(combinedOutput);

    if (result.exitCode !== 0 && !hasErrors) {
      this.logger.warn('Lint produced warnings (non-fatal)');
    }

    return {
      success: result.exitCode === 0 || !hasErrors,
      output: combinedOutput,
    };
  }

  /**
   * Runs backend build check.
   *
   * Uses build_command from component config if available.
   * For Go backends without explicit build_command, uses go build.
   * For TypeScript backends, uses npm run build.
   *
   * @returns Test result with success status and output
   */
  async runBackendBuild(): Promise<TestResult> {
    const rigConfig = this.config.get();
    const backendConfig = rigConfig.components?.backend;

    if (!backendConfig) {
      return { success: true, output: 'Backend not configured', skipped: true };
    }

    // Validate path for security
    this.validatePath(backendConfig.path);

    const backendDir = resolve(this.projectRoot, backendConfig.path);

    if (!existsSync(backendDir)) {
      return { success: true, output: '', skipped: true };
    }

    let buildCommand = backendConfig.build_command;

    // Auto-detect build command if not specified
    if (!buildCommand) {
      // Check if this is a Go backend (has go.mod)
      const goModExists = existsSync(resolve(backendDir, 'go.mod'));
      if (goModExists) {
        buildCommand = 'go build ./...';
      } else {
        // Check for Python backend (has requirements.txt or setup.py)
        const pythonExists = existsSync(resolve(backendDir, 'requirements.txt')) ||
                            existsSync(resolve(backendDir, 'setup.py'));
        if (pythonExists) {
          buildCommand = 'python -m build';
        } else {
          // Assume npm-based (TypeScript, etc.)
          buildCommand = 'npm run build';
        }
      }
    }

    // Validate command for security
    this.validateCommand(buildCommand);

    this.logger.config('Backend directory', backendConfig.path);
    this.logger.config('Build command', buildCommand);

    const startTime = Date.now();
    const result = await exec(`cd "${backendDir}" && ${buildCommand}`);
    const elapsed = Date.now() - startTime;

    this.logger.timing('Backend build', elapsed);

    return {
      success: result.exitCode === 0,
      output: result.stdout + result.stderr,
    };
  }

  /**
   * Runs backend tests.
   *
   * Uses test_command from component config (supports Go, TypeScript, Python, etc.)
   *
   * @returns Test result with success status and output
   */
  async runBackendTests(): Promise<TestResult> {
    const rigConfig = this.config.get();
    const backendConfig = rigConfig.components?.backend;

    if (!backendConfig) {
      return { success: true, output: 'Backend not configured', skipped: true };
    }

    // Validate path for security
    this.validatePath(backendConfig.path);

    const backendDir = resolve(this.projectRoot, backendConfig.path);

    if (!existsSync(backendDir)) {
      return { success: true, output: '', skipped: true };
    }

    // Validate command for security
    this.validateCommand(backendConfig.test_command);

    this.logger.config('Backend directory', backendConfig.path);
    this.logger.config('Test command', backendConfig.test_command);

    const startTime = Date.now();
    const result = await exec(`cd "${backendDir}" && ${backendConfig.test_command}`);
    const elapsed = Date.now() - startTime;

    this.logger.timing('Backend tests', elapsed);

    return {
      success: result.exitCode === 0,
      output: result.stdout + result.stderr,
    };
  }

  /**
   * Runs frontend linting.
   *
   * Uses lint_command from component config if available, otherwise defaults to npm run lint.
   * Attempts to auto-fix with `eslint --fix`, stages changes, then runs lint command.
   *
   * @returns Test result with success status and output
   */
  async runFrontendLint(): Promise<TestResult> {
    const rigConfig = this.config.get();
    const frontendConfig = rigConfig.components?.frontend;

    if (!frontendConfig) {
      return { success: true, output: 'Frontend not configured', skipped: true };
    }

    // Validate path for security
    this.validatePath(frontendConfig.path);

    const frontendDir = resolve(this.projectRoot, frontendConfig.path);

    if (!existsSync(frontendDir)) {
      return { success: true, output: '', skipped: true };
    }

    let lintCommand = frontendConfig.lint_command || 'npm run lint';

    // Validate command for security
    this.validateCommand(lintCommand);

    this.logger.config('Frontend directory', frontendConfig.path);
    this.logger.config('Lint command', lintCommand);

    const startTime = Date.now();

    // Try auto-fix first (assumes frontend uses eslint)
    await exec(`cd "${frontendDir}" && npx eslint --fix src/`);
    await exec(`cd "${this.projectRoot}" && git add -A ${frontendConfig.path}/src/`);

    // Verify it passes (--quiet suppresses warnings, only errors fail)
    const result = await exec(`cd "${frontendDir}" && npx eslint --quiet src/`);
    const elapsed = Date.now() - startTime;

    this.logger.timing('Frontend lint', elapsed);

    // Treat warnings as non-fatal: only fail if output contains "Error" lines
    const combinedOutput = result.stdout + result.stderr;
    const hasErrors = this.lintOutputHasErrors(combinedOutput);

    if (result.exitCode !== 0 && !hasErrors) {
      this.logger.warn('Lint produced warnings (non-fatal)');
    }

    return {
      success: result.exitCode === 0 || !hasErrors,
      output: combinedOutput,
    };
  }

  /**
   * Runs frontend build check.
   *
   * Uses build_command from component config if available, otherwise defaults to npm run build.
   *
   * @returns Test result with success status and output
   */
  async runFrontendBuild(): Promise<TestResult> {
    const rigConfig = this.config.get();
    const frontendConfig = rigConfig.components?.frontend;

    if (!frontendConfig) {
      return { success: true, output: 'Frontend not configured', skipped: true };
    }

    // Validate path for security
    this.validatePath(frontendConfig.path);

    const frontendDir = resolve(this.projectRoot, frontendConfig.path);

    if (!existsSync(frontendDir)) {
      return { success: true, output: '', skipped: true };
    }

    const buildCommand = frontendConfig.build_command || 'npm run build';

    // Validate command for security
    this.validateCommand(buildCommand);

    this.logger.config('Frontend directory', frontendConfig.path);
    this.logger.config('Build command', buildCommand);

    const startTime = Date.now();
    const result = await exec(`cd "${frontendDir}" && ${buildCommand}`);
    const elapsed = Date.now() - startTime;

    this.logger.timing('Frontend build', elapsed);

    return {
      success: result.exitCode === 0,
      output: result.stdout + result.stderr,
    };
  }

  /**
   * Runs frontend tests.
   *
   * Uses test_command from component config. Checks if test script exists in package.json
   * when using npm-based commands.
   *
   * @returns Test result with success status and output
   */
  async runFrontendTests(): Promise<TestResult> {
    const rigConfig = this.config.get();
    const frontendConfig = rigConfig.components?.frontend;

    if (!frontendConfig) {
      return { success: true, output: 'Frontend not configured', skipped: true };
    }

    // Validate path for security
    this.validatePath(frontendConfig.path);

    const frontendDir = resolve(this.projectRoot, frontendConfig.path);

    if (!existsSync(frontendDir)) {
      return { success: true, output: '', skipped: true };
    }

    // Check if test script exists (for npm-based commands)
    if (frontendConfig.test_command.includes('npm')) {
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
    }

    // Validate command for security
    this.validateCommand(frontendConfig.test_command);

    this.logger.config('Frontend directory', frontendConfig.path);
    this.logger.config('Test command', frontendConfig.test_command);

    const startTime = Date.now();
    const result = await exec(`cd "${frontendDir}" && ${frontendConfig.test_command}`);
    const elapsed = Date.now() - startTime;

    this.logger.timing('Frontend tests', elapsed);

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
  async runAllTests(component: 'backend' | 'frontend' | 'devnet' | 'fullstack'): Promise<AggregateTestResult> {
    const results: TestResult[] = [];

    // Ensure Docker is running if testing backend (may need testcontainers)
    if (component === 'backend' || component === 'fullstack') {
      const dockerReady = await this.ensureDockerRunning();
      if (!dockerReady) {
        this.logger.warn('Docker is not available. Backend tests may fail if they require containers.');
        console.log('');
      }
    }

    if (component === 'devnet') {
      results.push({ ...await this.runDevnetTests(), step: 'Devnet tests' });
      results.push({ ...await this.checkTestCoverage(component), step: 'Test coverage' });
    } else {
      if (component === 'backend' || component === 'fullstack') {
        results.push({ ...await this.runBackendLint(), step: 'Backend lint' });
        results.push({ ...await this.runBackendBuild(), step: 'Backend build' });
        results.push({ ...await this.runBackendTests(), step: 'Backend tests' });
      }

      if (component === 'frontend' || component === 'fullstack') {
        results.push({ ...await this.runFrontendLint(), step: 'Frontend lint' });
        results.push({ ...await this.runFrontendBuild(), step: 'Frontend build' });
        results.push({ ...await this.runFrontendTests(), step: 'Frontend tests' });
      }

      results.push({ ...await this.checkTestCoverage(component), step: 'Test coverage' });
    }

    // Aggregate results
    const success = results.every(r => r.success);
    const output = results.map(r => r.output).filter(o => o.length > 0).join('\n\n');
    const failedSteps = results.filter(r => !r.success && !r.skipped);

    return { success, output, steps: results, failedSteps };
  }

  /**
   * Ensures Docker is running, starting it if necessary.
   *
   * Checks if Docker daemon is accessible. If not, attempts to start Docker Desktop
   * on macOS and waits for it to be ready.
   *
   * @returns true if Docker is available, false otherwise
   */
  private async ensureDockerRunning(): Promise<boolean> {
    // Check if Docker is already running
    const checkResult = await exec('docker ps 2>&1');
    if (checkResult.exitCode === 0) {
      return true;
    }

    // Docker is not running - attempt to start it
    this.logger.info('Docker is not running. Attempting to start Docker Desktop...');

    const started = await this.startDockerDesktop();
    if (!started) {
      return false;
    }

    // Wait for Docker to be ready
    this.logger.info('Waiting for Docker to be ready...');
    const ready = await this.waitForDocker(60); // Wait up to 60 seconds

    if (ready) {
      this.logger.success('Docker is ready');
      console.log('');
    } else {
      this.logger.error('Docker failed to start within 60 seconds');
    }

    return ready;
  }

  /**
   * Starts Docker Desktop on macOS.
   *
   * @returns true if start command succeeded, false otherwise
   */
  private async startDockerDesktop(): Promise<boolean> {
    // Check platform
    const platform = process.platform;

    if (platform === 'darwin') {
      // macOS - use open command
      const result = await exec('open -a Docker 2>&1');
      return result.exitCode === 0;
    } else if (platform === 'win32') {
      // Windows - try to start Docker Desktop
      const result = await exec('start "" "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe" 2>&1');
      return result.exitCode === 0;
    } else if (platform === 'linux') {
      // Linux - try systemctl (most common)
      const result = await exec('sudo systemctl start docker 2>&1');
      if (result.exitCode === 0) {
        return true;
      }
      // Try service command as fallback
      const servicResult = await exec('sudo service docker start 2>&1');
      return servicResult.exitCode === 0;
    }

    return false;
  }

  /**
   * Waits for Docker daemon to be ready.
   *
   * Polls `docker ps` command until it succeeds or timeout is reached.
   *
   * @param timeoutSeconds - Maximum seconds to wait
   * @returns true if Docker became ready, false if timeout
   */
  private async waitForDocker(timeoutSeconds: number): Promise<boolean> {
    const startTime = Date.now();
    const timeoutMs = timeoutSeconds * 1000;

    while (Date.now() - startTime < timeoutMs) {
      const result = await exec('docker ps 2>&1');
      if (result.exitCode === 0) {
        return true;
      }

      // Wait 2 seconds before next check
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    return false;
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

  /**
   * Checks if lint output contains actual errors (not just warnings).
   *
   * Linters often exit non-zero for warnings too. This distinguishes
   * errors (fatal) from warnings (non-fatal) by checking the output.
   *
   * @param output - Combined stdout+stderr from lint command
   * @returns true if output contains error-level issues
   */
  private lintOutputHasErrors(output: string): boolean {
    const lines = output.split('\n');
    for (const line of lines) {
      // ESLint/Next.js format: "1:5  Error: ..."
      if (/\d+:\d+\s+Error/i.test(line)) return true;
      // golangci-lint format: "file.go:1:5: error ..."
      if (/\.go:\d+:\d+:.*error/i.test(line)) return true;
      // Generic "error" at start of line (not "Warning")
      if (/^\s*error\b/i.test(line) && !/warning/i.test(line)) return true;
    }
    return false;
  }
}
