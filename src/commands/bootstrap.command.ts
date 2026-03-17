import { BaseCommand } from './base-command.js';
import { Logger } from '../services/logger.service.js';
import { ConfigManager } from '../services/config-manager.service.js';
import { StateManager } from '../services/state-manager.service.js';
import { GitService } from '../services/git.service.js';
import { GitHubService } from '../services/github.service.js';
import { GuardService } from '../services/guard.service.js';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';
import * as readline from 'readline';
import { stringify as stringifyYaml } from 'yaml';
import { getLabelDetails } from '../types/labels.types.js';

const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);
const readFile = promisify(fs.readFile);
const execAsync = promisify(exec);

/**
 * Options for the bootstrap command.
 */
export interface BootstrapOptions {
  /** Target component to bootstrap (frontend, backend, infra, serverless, node, all) */
  component?: 'frontend' | 'backend' | 'infra' | 'serverless' | 'node' | 'all';
}

/**
 * BootstrapCommand sets up test infrastructure for the project.
 *
 * Installs test dependencies (vitest, testing-library, msw, playwright)
 * and creates config files, test setup, and mock handlers.
 *
 * All operations are idempotent — skips files that already exist.
 */
export class BootstrapCommand extends BaseCommand {
  /**
   * Creates a new BootstrapCommand instance.
   */
  constructor(
    logger: Logger,
    config: ConfigManager,
    state: StateManager,
    git: GitService,
    github: GitHubService,
    guard: GuardService,
    projectRoot?: string
  ) {
    super(logger, config, state, git, github, guard, projectRoot);
  }

  /**
   * Executes the bootstrap command.
   *
   * Sets up test infrastructure based on the component type.
   *
   * @param options - Bootstrap options
   */
  async execute(options: BootstrapOptions = {}): Promise<void> {
    this.logger.header('Bootstrap Test Infrastructure');
    console.log('');

    const component = options.component || await this.promptForComponent();

    let frontendPath: string | null = null;
    let backendPath: string | null = null;
    let infraPath: string | null = null;
    let serverlessPath: string | null = null;
    let nodePath: string | null = null;
    let backendType: 'go' | 'typescript' | undefined = undefined;

    // Calculate total steps dynamically (+1 for label sync)
    const totalSteps =
      (component === 'frontend' || component === 'all' ? 1 : 0) +
      (component === 'backend' || component === 'all' ? 1 : 0) +
      (component === 'infra' || component === 'all' ? 1 : 0) +
      (component === 'serverless' || component === 'all' ? 1 : 0) +
      (component === 'node' ? 1 : 0) +
      1; // label sync

    let currentStep = 0;

    if (component === 'frontend' || component === 'all') {
      frontendPath = await this.promptForPath('frontend');
      if (frontendPath) {
        await this.bootstrapFrontend(frontendPath, ++currentStep, totalSteps);
      }
    }

    if (component === 'backend' || component === 'all') {
      backendPath = await this.promptForPath('backend');
      if (backendPath) {
        backendType = await this.bootstrapBackend(backendPath, ++currentStep, totalSteps);
      }
    }

    if (component === 'infra' || component === 'all') {
      infraPath = await this.promptForPath('infra');
      if (infraPath) {
        await this.bootstrapInfra(infraPath, ++currentStep, totalSteps);
      }
    }

    if (component === 'serverless' || component === 'all') {
      serverlessPath = await this.promptForPath('serverless');
      if (serverlessPath) {
        await this.bootstrapServerless(serverlessPath, ++currentStep, totalSteps);
      }
    }

    if (component === 'node') {
      nodePath = await this.promptForPath('node');
      if (nodePath) {
        await this.bootstrapNode(nodePath, ++currentStep, totalSteps);
      }
    }

    // Save paths to config if provided
    if (frontendPath || backendPath || infraPath || serverlessPath || nodePath) {
      await this.saveComponentPaths(frontendPath, backendPath, infraPath, serverlessPath, backendType, nodePath);
    }

    // Sync labels to GitHub
    await this.syncLabels(++currentStep, totalSteps);

    console.log('');
    this.logger.success('Bootstrap complete! Test infrastructure is ready.');
    this.logger.info('Run tests to verify setup.');
  }

  /**
   * Bootstraps frontend test infrastructure.
   *
   * @param frontendPath - Path to frontend directory
   * @param step - Current step number
   * @param totalSteps - Total number of steps
   */
  private async bootstrapFrontend(frontendPath: string, step: number, totalSteps: number): Promise<void> {
    this.logger.step(step, totalSteps, 'Setting up frontend test infrastructure...');
    console.log('');

    // Step 1: Install dependencies
    this.logger.info('Installing frontend test dependencies...');
    try {
      await execAsync(
        'npm install --save-dev vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom msw @vitest/coverage-v8',
        { cwd: frontendPath }
      );
      this.logger.success('Frontend test dependencies installed');
    } catch (error) {
      this.logger.warn('Failed to install dependencies (may already be installed)');
    }

    // Step 2: Create vitest config
    this.logger.info('Creating vitest config...');
    const vitestConfigPath = path.join(frontendPath, 'vitest.config.ts');
    if (!fs.existsSync(vitestConfigPath)) {
      await writeFile(vitestConfigPath, this.generateVitestConfig());
      this.logger.success('Created vitest.config.ts');
    } else {
      this.logger.dim('vitest.config.ts already exists, skipping');
    }

    // Step 3: Create test setup files
    this.logger.info('Creating test setup files...');
    const testDir = path.join(frontendPath, 'src', 'test');
    const mocksDir = path.join(testDir, 'mocks');

    await mkdir(testDir, { recursive: true });
    await mkdir(mocksDir, { recursive: true });

    // setup.ts
    const setupPath = path.join(testDir, 'setup.ts');
    if (!fs.existsSync(setupPath)) {
      await writeFile(setupPath, this.generateTestSetup());
      this.logger.success('Created src/test/setup.ts');
    } else {
      this.logger.dim('src/test/setup.ts already exists, skipping');
    }

    // render.tsx
    const renderPath = path.join(testDir, 'render.tsx');
    if (!fs.existsSync(renderPath)) {
      await writeFile(renderPath, this.generateTestRender());
      this.logger.success('Created src/test/render.tsx');
    } else {
      this.logger.dim('src/test/render.tsx already exists, skipping');
    }

    // handlers.ts
    const handlersPath = path.join(mocksDir, 'handlers.ts');
    if (!fs.existsSync(handlersPath)) {
      await writeFile(handlersPath, this.generateMockHandlers());
      this.logger.success('Created src/test/mocks/handlers.ts');
    } else {
      this.logger.dim('src/test/mocks/handlers.ts already exists, skipping');
    }

    // Step 4: Update package.json scripts
    this.logger.info('Updating package.json scripts...');
    await this.updatePackageJsonScripts(frontendPath);
    this.logger.success('Updated package.json scripts');

    console.log('');
  }

  /**
   * Bootstraps backend test infrastructure.
   *
   * @param backendPath - Path to backend directory
   * @param step - Current step number
   * @param totalSteps - Total number of steps
   * @returns Backend type ('go' or 'typescript')
   */
  private async bootstrapBackend(backendPath: string, step: number, totalSteps: number): Promise<'go' | 'typescript'> {
    this.logger.step(step, totalSteps, 'Setting up backend test infrastructure...');
    console.log('');

    // Prompt user to choose backend type
    const backendType = await this.prompt('Is this a Go or TypeScript backend? (go/typescript) [go]: ');
    const normalized = (backendType?.trim().toLowerCase()) || 'go';

    const finalType: 'go' | 'typescript' = (normalized === 'typescript' || normalized === 'ts') ? 'typescript' : 'go';

    if (finalType === 'typescript') {
      await this.bootstrapBackendTypeScript(backendPath);
    } else {
      // Default to Go (includes empty input)
      this.logger.info('Backend uses Go testing (built-in), no additional setup needed');
      this.logger.dim('Ensure tests follow *_test.go naming convention');
    }

    console.log('');
    return finalType;
  }

  /**
   * Bootstraps TypeScript backend test infrastructure with testcontainers.
   *
   * @param backendPath - Path to backend directory
   */
  private async bootstrapBackendTypeScript(backendPath: string): Promise<void> {
    // Install backend testing dependencies
    this.logger.info('Installing backend test dependencies...');
    this.logger.dim('Note: Tests will require Docker to be running for testcontainers');
    try {
      await execAsync(
        'npm install --save-dev vitest @vitest/ui testcontainers @testcontainers/postgresql pg @types/pg',
        { cwd: backendPath }
      );
      this.logger.success('Backend test dependencies installed');
    } catch (error) {
      this.logger.warn('Failed to install dependencies (may already be installed)');
    }

    console.log('');

    // Create vitest.config.ts
    const vitestConfigPath = path.join(backendPath, 'vitest.config.ts');
    if (!fs.existsSync(vitestConfigPath)) {
      this.logger.info('Creating vitest.config.ts...');
      const vitestConfig = `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    // Extended timeouts for testcontainers
    // Docker containers need time to download images and start
    // Reduce these if you experience hanging tests
    testTimeout: 60000, // 60 seconds
    hookTimeout: 60000, // 60 seconds
  },
});
`;
      await fs.promises.writeFile(vitestConfigPath, vitestConfig);
      this.logger.success('Created vitest.config.ts');
    } else {
      this.logger.dim('vitest.config.ts already exists, skipping');
    }

    console.log('');

    // Create test setup directory
    const testDir = path.join(backendPath, 'src', 'test');
    await fs.promises.mkdir(testDir, { recursive: true });

    // Create test setup file
    const setupPath = path.join(testDir, 'setup.ts');
    if (!fs.existsSync(setupPath)) {
      this.logger.info('Creating src/test/setup.ts...');
      const setupContent = `import { beforeAll, afterAll } from 'vitest';

// Global test setup
beforeAll(async () => {
  // Add any global setup here
});

afterAll(async () => {
  // Add any global cleanup here
});
`;
      await fs.promises.writeFile(setupPath, setupContent);
      this.logger.success('Created src/test/setup.ts');
    } else {
      this.logger.dim('src/test/setup.ts already exists, skipping');
    }

    console.log('');

    // Create test helpers directory
    const helpersDir = path.join(testDir, 'helpers');
    await fs.promises.mkdir(helpersDir, { recursive: true });

    // Create PostgreSQL testcontainer helper
    const dbHelperPath = path.join(helpersDir, 'db.helper.ts');
    if (!fs.existsSync(dbHelperPath)) {
      this.logger.info('Creating src/test/helpers/db.helper.ts...');
      const dbHelperContent = `import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';

/**
 * Test database helper using testcontainers.
 * Provides isolated PostgreSQL instance for each test suite.
 *
 * Requires Docker to be running.
 */
export class TestDatabase {
  private container?: StartedPostgreSqlContainer;
  private pool?: Pool;

  /**
   * Start PostgreSQL testcontainer and create connection pool
   * @param image - Docker image to use (default: postgres:16-alpine)
   */
  async start(image = 'postgres:16-alpine'): Promise<void> {
    if (this.container) {
      throw new Error('Container already started');
    }

    try {
      this.container = await new PostgreSqlContainer(image)
        .withDatabase('test_db')
        .withUsername('test_user')
        .withPassword('test_password')
        .start();

      this.pool = new Pool({
        host: this.container.getHost(),
        port: this.container.getPort(),
        database: this.container.getDatabase(),
        user: this.container.getUsername(),
        password: this.container.getPassword(),
      });
    } catch (error) {
      throw new Error(
        \`Failed to start PostgreSQL container. Is Docker running? Error: \${error instanceof Error ? error.message : String(error)}\`
      );
    }
  }

  /**
   * Stop PostgreSQL testcontainer and close connections
   */
  async stop(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = undefined;
    }
    if (this.container) {
      await this.container.stop();
      this.container = undefined;
    }
  }

  /**
   * Get the database connection pool
   * @throws Error if container is not started
   */
  getPool(): Pool {
    if (!this.pool) {
      throw new Error('Database not started. Call start() first.');
    }
    return this.pool;
  }
}
`;
      await fs.promises.writeFile(dbHelperPath, dbHelperContent);
      this.logger.success('Created src/test/helpers/db.helper.ts');
    } else {
      this.logger.dim('src/test/helpers/db.helper.ts already exists, skipping');
    }

    console.log('');

    // Create example test file
    const exampleTestPath = path.join(testDir, 'example.test.ts');
    if (!fs.existsSync(exampleTestPath)) {
      this.logger.info('Creating src/test/example.test.ts...');
      const exampleTestContent = `import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { TestDatabase } from './helpers/db.helper';

describe('Database Tests', () => {
  const db = new TestDatabase();

  beforeAll(async () => {
    // Start PostgreSQL container (requires Docker to be running)
    await db.start();
  });

  afterAll(async () => {
    // Stop container and cleanup
    await db.stop();
  });

  afterEach(async () => {
    // Clean up test data after each test
    const pool = db.getPool();
    await pool.query('DROP TABLE IF EXISTS users');
  });

  it('should connect to PostgreSQL', async () => {
    const pool = db.getPool();
    const result = await pool.query('SELECT 1 as value');
    expect(result.rows[0].value).toBe(1);
  });

  it('should create and query a table', async () => {
    const pool = db.getPool();

    // Create table
    await pool.query(\`
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL
      )
    \`);

    // Insert test data using parameterized query (prevents SQL injection)
    await pool.query('INSERT INTO users (name) VALUES ($1)', ['Test User']);

    // Query with parameterized query
    const result = await pool.query('SELECT * FROM users WHERE name = $1', ['Test User']);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].name).toBe('Test User');
  });

  it('should handle multiple inserts and queries', async () => {
    const pool = db.getPool();

    await pool.query(\`
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL
      )
    \`);

    // Insert multiple users
    await pool.query('INSERT INTO users (name) VALUES ($1), ($2), ($3)',
      ['Alice', 'Bob', 'Charlie']);

    // Query all users
    const result = await pool.query('SELECT * FROM users ORDER BY name');

    expect(result.rows).toHaveLength(3);
    expect(result.rows[0].name).toBe('Alice');
    expect(result.rows[1].name).toBe('Bob');
    expect(result.rows[2].name).toBe('Charlie');
  });
});
`;
      await fs.promises.writeFile(exampleTestPath, exampleTestContent);
      this.logger.success('Created src/test/example.test.ts');
    } else {
      this.logger.dim('src/test/example.test.ts already exists, skipping');
    }

    console.log('');

    // Update package.json scripts
    this.logger.info('Updating package.json scripts...');
    await this.updatePackageJsonScripts(backendPath);
    this.logger.success('Updated package.json scripts');
  }

  /**
   * Bootstraps infra test infrastructure.
   *
   * @param _infraPath - Path to infra directory (unused, no setup needed for IaC)
   * @param step - Current step number
   * @param totalSteps - Total number of steps
   */
  private async bootstrapInfra(_infraPath: string, step: number, totalSteps: number): Promise<void> {
    this.logger.step(step, totalSteps, 'Setting up infra test infrastructure...');
    console.log('');

    // Infra typically uses IaC-specific testing tools
    this.logger.info('Infra testing typically uses IaC-specific tools');
    this.logger.dim('Example: terraform validate && terraform plan');
    this.logger.dim('Configure test_command in .rig/config.json for your IaC tool');

    console.log('');
  }

  /**
   * Bootstraps serverless test infrastructure.
   *
   * @param _serverlessPath - Path to serverless directory (unused, no setup needed)
   * @param step - Current step number
   * @param totalSteps - Total number of steps
   */
  private async bootstrapServerless(_serverlessPath: string, step: number, totalSteps: number): Promise<void> {
    this.logger.step(step, totalSteps, 'Setting up serverless test infrastructure...');
    console.log('');

    // Serverless uses framework-specific testing tools
    this.logger.info('Serverless uses framework-specific testing (Serverless Framework, SAM, etc.)');
    this.logger.dim('Example: serverless invoke test or npm test');
    this.logger.dim('Configure test_command in .rig/config.json for your serverless framework');

    console.log('');
  }

  /**
   * Bootstraps Node.js project test infrastructure.
   *
   * Detects existing dependencies, installs vitest if needed,
   * creates vitest.config.ts and tests/ directory.
   *
   * @param nodePath - Path to node project directory
   * @param step - Current step number
   * @param totalSteps - Total number of steps
   */
  private async bootstrapNode(nodePath: string, step: number, totalSteps: number): Promise<void> {
    this.logger.step(step, totalSteps, 'Setting up Node.js test infrastructure...');
    console.log('');

    // Read package.json to detect existing deps
    const packageJsonPath = path.join(nodePath, 'package.json');
    let packageJson: any = {};
    if (fs.existsSync(packageJsonPath)) {
      try {
        const content = await readFile(packageJsonPath, 'utf-8');
        packageJson = JSON.parse(content);
      } catch {
        this.logger.warn('Could not read package.json');
      }
    }

    // Install vitest if not already present
    const devDeps = packageJson.devDependencies || {};
    if (!devDeps.vitest) {
      this.logger.info('Installing vitest...');
      try {
        await execAsync('npm install --save-dev vitest @vitest/coverage-v8', { cwd: nodePath });
        this.logger.success('Vitest installed');
      } catch (error) {
        this.logger.warn('Failed to install vitest (may already be installed)');
      }
    } else {
      this.logger.dim('vitest already installed, skipping');
    }

    // Create vitest.config.ts if missing
    const vitestConfigPath = path.join(nodePath, 'vitest.config.ts');
    if (!fs.existsSync(vitestConfigPath)) {
      this.logger.info('Creating vitest.config.ts...');
      await writeFile(vitestConfigPath, this.generateNodeVitestConfig());
      this.logger.success('Created vitest.config.ts');
    } else {
      this.logger.dim('vitest.config.ts already exists, skipping');
    }

    // Create tests/ directory if missing
    const testsDir = path.join(nodePath, 'tests');
    if (!fs.existsSync(testsDir)) {
      this.logger.info('Creating tests/ directory...');
      await mkdir(testsDir, { recursive: true });
      this.logger.success('Created tests/ directory');
    } else {
      this.logger.dim('tests/ directory already exists, skipping');
    }

    // Verify package.json scripts
    this.logger.info('Checking package.json scripts...');
    const scripts = packageJson.scripts || {};
    if (scripts.test) {
      this.logger.dim(`test script found: ${scripts.test}`);
    } else {
      this.logger.warn('No test script found in package.json');
    }
    if (scripts['test:coverage']) {
      this.logger.dim(`test:coverage script found: ${scripts['test:coverage']}`);
    }

    console.log('');
  }

  /**
   * Detects Node.js project commands from package.json scripts.
   *
   * @param nodePath - Path to node project directory
   * @returns Object with detected test_command, lint_command, build_command
   */
  private detectNodeCommands(nodePath: string): { test_command: string; lint_command?: string; build_command?: string } {
    const packageJsonPath = path.join(nodePath, 'package.json');
    const result: { test_command: string; lint_command?: string; build_command?: string } = {
      test_command: 'npm test',
    };

    if (!fs.existsSync(packageJsonPath)) {
      return result;
    }

    try {
      const content = fs.readFileSync(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(content);
      const scripts = packageJson.scripts || {};

      if (scripts.test) {
        result.test_command = 'npm test';
      }
      if (scripts.lint) {
        result.lint_command = 'npm run lint';
      }
      if (scripts.build) {
        result.build_command = 'npm run build';
      }
    } catch {
      // Use defaults
    }

    return result;
  }

  /**
   * Generates vitest.config.ts content for Node.js projects.
   */
  private generateNodeVitestConfig(): string {
    return `import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.{ts,js}', 'src/**/*.test.{ts,js}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,js}'],
      exclude: ['src/**/*.test.{ts,js}'],
    },
  },
})
`;
  }

  /**
   * Generates vitest.config.ts content.
   */
  private generateVitestConfig(): string {
    return `import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/test/**', 'src/**/*.test.{ts,tsx}'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
`;
  }

  /**
   * Generates test setup.ts content.
   */
  private generateTestSetup(): string {
    return `import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})
`;
  }

  /**
   * Generates test render.tsx content.
   */
  private generateTestRender(): string {
    return `import { render, RenderOptions } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactElement } from 'react'

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

function AllProviders({ children }: { children: React.ReactNode }) {
  const queryClient = createTestQueryClient()
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}

function customRender(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  return render(ui, { wrapper: AllProviders, ...options })
}

export { customRender as render }
export { screen, waitFor, within } from '@testing-library/react'
export { default as userEvent } from '@testing-library/user-event'
`;
  }

  /**
   * Generates mock handlers.ts content.
   */
  private generateMockHandlers(): string {
    return `import { http, HttpResponse } from 'msw'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'

export const handlers = [
  // Auth endpoints
  http.post(\`\${API_URL}/api/v1/auth/login\`, () => {
    return HttpResponse.json({
      token: 'test-token',
      user: { id: '1', email: 'test@example.com', name: 'Test User' },
    })
  }),

  http.get(\`\${API_URL}/api/v1/auth/me\`, () => {
    return HttpResponse.json({
      id: '1',
      email: 'test@example.com',
      name: 'Test User',
    })
  }),
]
`;
  }

  /**
   * Updates package.json to add test scripts.
   *
   * @param targetPath - Path to directory containing package.json
   */
  private async updatePackageJsonScripts(targetPath: string): Promise<void> {
    const packageJsonPath = path.join(targetPath, 'package.json');

    if (!fs.existsSync(packageJsonPath)) {
      this.logger.warn('package.json not found, skipping script updates');
      return;
    }

    const content = await readFile(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(content);

    // Add test scripts if they don't exist
    if (!packageJson.scripts) {
      packageJson.scripts = {};
    }

    if (!packageJson.scripts.test) {
      packageJson.scripts.test = 'vitest run';
    }
    if (!packageJson.scripts['test:watch']) {
      packageJson.scripts['test:watch'] = 'vitest';
    }
    if (!packageJson.scripts['test:coverage']) {
      packageJson.scripts['test:coverage'] = 'vitest run --coverage';
    }

    await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
  }

  /**
   * Syncs rig labels to the GitHub repository.
   *
   * @param step - Current step number
   * @param totalSteps - Total number of steps
   */
  private async syncLabels(step: number, totalSteps: number): Promise<void> {
    this.logger.step(step, totalSteps, 'Syncing labels to GitHub...');
    console.log('');

    try {
      const labels = getLabelDetails();
      const result = await this.github.syncLabels(labels);

      if (result.created.length > 0) {
        this.logger.success(`Created ${result.created.length} new labels`);
      }
      if (result.existing.length > 0) {
        this.logger.dim(`Updated ${result.existing.length} existing labels`);
      }
    } catch (error) {
      this.logger.warn(
        `Failed to sync labels: ${error instanceof Error ? error.message : 'unknown error'}`
      );
      this.logger.dim('You can run "rig setup-labels" later to create labels');
    }

    console.log('');
  }

  /**
   * Prompts user to select component type.
   *
   * @returns The selected component type
   */
  private async promptForComponent(): Promise<'frontend' | 'backend' | 'infra' | 'serverless' | 'node' | 'all'> {
    const answer = await this.prompt(
      'Which component(s) do you want to bootstrap? (frontend/backend/infra/serverless/node/all) [all]: '
    );
    const normalized = answer.trim().toLowerCase();

    if (normalized === 'frontend' || normalized === 'backend' || normalized === 'infra' || normalized === 'serverless' || normalized === 'node' || normalized === 'all') {
      return normalized;
    }

    return 'all'; // Default
  }

  /**
   * Prompts user for directory path and validates it exists.
   *
   * @param componentType - Type of component (frontend/backend/infra/serverless)
   * @returns Absolute path to directory, or null if skipped
   */
  private async promptForPath(componentType: string): Promise<string | null> {
    const projectRoot = this.projectRoot || process.cwd();
    let defaultPath = './backend';
    if (componentType === 'frontend') defaultPath = './frontend';
    if (componentType === 'infra') defaultPath = './infra';
    if (componentType === 'serverless') defaultPath = './serverless';
    if (componentType === 'node') defaultPath = '.';

    const answer = await this.prompt(
      `Path to ${componentType} directory [${defaultPath}, or 'skip' to skip]: `
    );
    const normalized = answer.trim().toLowerCase();

    if (normalized === 'skip' || normalized === 's') {
      this.logger.info(`Skipping ${componentType} setup`);
      return null;
    }

    // For node component, empty input accepts the default (current dir)
    // For other components, empty input skips
    if (normalized === '' && componentType !== 'node') {
      this.logger.info(`Skipping ${componentType} setup`);
      return null;
    }

    // Support both relative and absolute paths
    const userPath = answer.trim() || defaultPath;
    const absolutePath = path.isAbsolute(userPath)
      ? userPath
      : path.join(projectRoot, userPath);

    // Check if directory exists
    if (!fs.existsSync(absolutePath)) {
      this.logger.warn(`Directory not found: ${absolutePath}`);
      const createIt = await this.confirm(`Create directory ${absolutePath}? (y/N): `);

      if (createIt) {
        await mkdir(absolutePath, { recursive: true });
        this.logger.success(`Created directory: ${absolutePath}`);
        return absolutePath;
      } else {
        this.logger.info(`Skipping ${componentType} setup`);
        return null;
      }
    }

    return absolutePath;
  }

  /**
   * Saves component paths to .rig/config.json.
   *
   * @param frontendPath - Path to frontend directory
   * @param backendPath - Path to backend directory
   * @param infraPath - Path to infra directory
   * @param serverlessPath - Path to serverless directory
   * @param backendType - Backend language type ('go' or 'typescript')
   */
  private async saveComponentPaths(
    frontendPath: string | null,
    backendPath: string | null,
    infraPath: string | null,
    serverlessPath: string | null,
    backendType?: 'go' | 'typescript',
    nodePath?: string | null
  ): Promise<void> {
    try {
      const config = this.config.get();

      if (!config.components) {
        config.components = {};
      }

      if (frontendPath) {
        config.components.frontend = {
          path: frontendPath,
          test_command: 'npm test',
        };
      }

      if (backendPath) {
        const testCommand = backendType === 'typescript' ? 'npm test' : 'go test ./...';
        config.components.backend = {
          path: backendPath,
          test_command: testCommand,
        };
      }

      if (infraPath) {
        config.components.infra = {
          path: infraPath,
          test_command: 'terraform validate && terraform plan',
        };
      }

      if (serverlessPath) {
        config.components.serverless = {
          path: serverlessPath,
          test_command: 'npm test',
        };
      }

      if (nodePath) {
        const detected = this.detectNodeCommands(nodePath);
        config.components.node = {
          path: nodePath,
          test_command: detected.test_command,
          lint_command: detected.lint_command,
          build_command: detected.build_command,
        };
      }

      // Save updated config to .rig.yml
      const configPath = path.join(
        this.projectRoot || process.cwd(),
        '.rig.yml'
      );

      await writeFile(configPath, stringifyYaml(config));

      this.logger.dim('Saved component paths to .rig.yml');
    } catch (error) {
      this.logger.warn('Failed to save component paths to config');
    }
  }

  /**
   * Prompts the user for input.
   *
   * @param question - The question to ask
   * @returns The user's answer
   */
  private prompt(question: string): Promise<string> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      // Handle Ctrl+C
      const sigintHandler = () => {
        rl.close();
        console.log(''); // Newline after ^C
        resolve('skip');
      };
      process.once('SIGINT', sigintHandler);

      rl.question(question, (answer) => {
        process.removeListener('SIGINT', sigintHandler);
        rl.close();
        resolve(answer);
      });
    });
  }

}
