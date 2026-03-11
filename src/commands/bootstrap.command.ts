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

const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);
const readFile = promisify(fs.readFile);
const execAsync = promisify(exec);

/**
 * Options for the bootstrap command.
 */
export interface BootstrapOptions {
  /** Target component to bootstrap (frontend, backend, infra, all) */
  component?: 'frontend' | 'backend' | 'infra' | 'all';
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

    // Calculate total steps dynamically
    const totalSteps =
      (component === 'frontend' || component === 'all' ? 1 : 0) +
      (component === 'backend' || component === 'all' ? 1 : 0) +
      (component === 'infra' || component === 'all' ? 1 : 0);

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
        await this.bootstrapBackend(backendPath, ++currentStep, totalSteps);
      }
    }

    if (component === 'infra' || component === 'all') {
      infraPath = await this.promptForPath('infra');
      if (infraPath) {
        await this.bootstrapInfra(infraPath, ++currentStep, totalSteps);
      }
    }

    // Save paths to config if provided
    if (frontendPath || backendPath || infraPath) {
      await this.saveComponentPaths(frontendPath, backendPath, infraPath);
    }

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
   * @param _backendPath - Path to backend directory (unused, no setup needed for Go)
   * @param step - Current step number
   * @param totalSteps - Total number of steps
   */
  private async bootstrapBackend(_backendPath: string, step: number, totalSteps: number): Promise<void> {
    this.logger.step(step, totalSteps, 'Setting up backend test infrastructure...');
    console.log('');

    // Backend typically uses Go with built-in testing
    // Just verify the structure is correct
    this.logger.info('Backend uses Go testing (built-in), no additional setup needed');
    this.logger.dim('Ensure tests follow *_test.go naming convention');

    console.log('');
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
   * Prompts user to select component type.
   *
   * @returns The selected component type
   */
  private async promptForComponent(): Promise<'frontend' | 'backend' | 'infra' | 'all'> {
    const answer = await this.prompt(
      'Which component(s) do you want to bootstrap? (frontend/backend/infra/all) [all]: '
    );
    const normalized = answer.trim().toLowerCase();

    if (normalized === 'frontend' || normalized === 'backend' || normalized === 'infra' || normalized === 'all') {
      return normalized;
    }

    return 'all'; // Default
  }

  /**
   * Prompts user for directory path and validates it exists.
   *
   * @param componentType - Type of component (frontend/backend/infra)
   * @returns Absolute path to directory, or null if skipped
   */
  private async promptForPath(componentType: string): Promise<string | null> {
    const projectRoot = this.projectRoot || process.cwd();
    let defaultPath = './backend';
    if (componentType === 'frontend') defaultPath = './frontend';
    if (componentType === 'infra') defaultPath = './infra';

    const answer = await this.prompt(
      `Path to ${componentType} directory [${defaultPath}, or 'skip' to skip]: `
    );
    const normalized = answer.trim().toLowerCase();

    if (normalized === 'skip' || normalized === 's' || normalized === '') {
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
   */
  private async saveComponentPaths(
    frontendPath: string | null,
    backendPath: string | null,
    infraPath: string | null
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
        config.components.backend = {
          path: backendPath,
          test_command: 'go test ./...',
        };
      }

      if (infraPath) {
        config.components.infra = {
          path: infraPath,
          test_command: 'terraform validate && terraform plan',
        };
      }

      // Save updated config
      const configPath = path.join(
        this.projectRoot || process.cwd(),
        '.rig',
        'config.json'
      );
      const configDir = path.dirname(configPath);

      await mkdir(configDir, { recursive: true });
      await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');

      this.logger.dim('Saved component paths to .rig/config.json');
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

  /**
   * Prompts the user for confirmation.
   *
   * @param question - The question to ask
   * @returns True if user confirmed (y/yes), false otherwise
   */
  private confirm(question: string): Promise<boolean> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      // Handle Ctrl+C
      const sigintHandler = () => {
        rl.close();
        console.log(''); // Newline after ^C
        resolve(false);
      };
      process.once('SIGINT', sigintHandler);

      rl.question(question, (answer) => {
        process.removeListener('SIGINT', sigintHandler);
        rl.close();
        const normalized = answer.trim().toLowerCase();
        resolve(normalized === 'y' || normalized === 'yes');
      });
    });
  }
}
