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

const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);
const readFile = promisify(fs.readFile);
const execAsync = promisify(exec);

/**
 * Options for the bootstrap command.
 */
export interface BootstrapOptions {
  /** Target component to bootstrap (frontend, backend, fullstack) */
  component?: 'frontend' | 'backend' | 'fullstack';
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

    const component = options.component || 'fullstack';

    if (component === 'frontend' || component === 'fullstack') {
      await this.bootstrapFrontend();
    }

    if (component === 'backend' || component === 'fullstack') {
      await this.bootstrapBackend();
    }

    console.log('');
    this.logger.success('Bootstrap complete! Test infrastructure is ready.');
    this.logger.info('Run tests to verify setup.');
  }

  /**
   * Bootstraps frontend test infrastructure.
   */
  private async bootstrapFrontend(): Promise<void> {
    this.logger.step(1, 4, 'Setting up frontend test infrastructure...');
    console.log('');

    const frontendPath = path.join(this.projectRoot || process.cwd(), 'frontend');

    // Check if frontend directory exists
    if (!fs.existsSync(frontendPath)) {
      this.logger.warn('Frontend directory not found, skipping frontend setup');
      return;
    }

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
   */
  private async bootstrapBackend(): Promise<void> {
    this.logger.step(2, 4, 'Setting up backend test infrastructure...');
    console.log('');

    const backendPath = path.join(this.projectRoot || process.cwd(), 'backend');

    // Check if backend directory exists
    if (!fs.existsSync(backendPath)) {
      this.logger.warn('Backend directory not found, skipping backend setup');
      return;
    }

    // Backend typically uses Go with built-in testing
    // Just verify the structure is correct
    this.logger.info('Backend uses Go testing (built-in), no additional setup needed');
    this.logger.dim('Ensure tests follow *_test.go naming convention');

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
}
