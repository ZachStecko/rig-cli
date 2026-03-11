import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BootstrapCommand } from '../../src/commands/bootstrap.command.js';
import { Logger } from '../../src/services/logger.service.js';
import { ConfigManager } from '../../src/services/config-manager.service.js';
import { StateManager } from '../../src/services/state-manager.service.js';
import { GitService } from '../../src/services/git.service.js';
import { GitHubService } from '../../src/services/github.service.js';
import { GuardService } from '../../src/services/guard.service.js';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const rm = promisify(fs.rm);

// Mock child_process.exec
vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

describe('BootstrapCommand', () => {
  let command: BootstrapCommand;
  let mockLogger: Logger;
  let mockConfig: ConfigManager;
  let mockState: StateManager;
  let mockGit: GitService;
  let mockGitHub: GitHubService;
  let mockGuard: GuardService;
  let testProjectRoot: string;

  beforeEach(async () => {
    mockLogger = {
      header: vi.fn(),
      dim: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      step: vi.fn(),
    } as any;

    mockConfig = {
      load: vi.fn(),
      get: vi.fn().mockReturnValue({ agent: { max_turns: 20 } }),
    } as any;

    mockState = {
      exists: vi.fn(),
      read: vi.fn(),
      write: vi.fn(),
    } as any;

    mockGit = {
      currentBranch: vi.fn(),
    } as any;

    mockGitHub = {
      viewIssue: vi.fn(),
    } as any;

    mockGuard = {
      requireGhAuth: vi.fn(),
    } as any;

    // Create temp project directory
    testProjectRoot = path.join(process.cwd(), '.tmp-bootstrap-test');
    await mkdir(testProjectRoot, { recursive: true });

    // Mock exec to succeed
    vi.mocked(exec).mockImplementation((cmd, options, callback) => {
      if (callback) {
        callback(null, { stdout: 'success', stderr: '' } as any, '');
      }
      return {} as any;
    });

    command = new BootstrapCommand(
      mockLogger,
      mockConfig,
      mockState,
      mockGit,
      mockGitHub,
      mockGuard,
      testProjectRoot
    );

    // Mock prompt methods to return paths that will be created
    (command as any).prompt = vi.fn().mockImplementation((question: any) => {
      const q = String(question);
      if (q.includes('component')) {
        return Promise.resolve('all');
      }
      if (q.includes('frontend')) {
        return Promise.resolve(path.join(testProjectRoot, 'frontend'));
      }
      if (q.includes('backend')) {
        return Promise.resolve(path.join(testProjectRoot, 'backend'));
      }
      if (q.includes('infra')) {
        return Promise.resolve(path.join(testProjectRoot, 'infra'));
      }
      return Promise.resolve('');
    });

    (command as any).confirm = vi.fn().mockResolvedValue(false);
  });

  afterEach(async () => {
    // Clean up temp directory
    if (fs.existsSync(testProjectRoot)) {
      await rm(testProjectRoot, { recursive: true, force: true });
    }
    vi.clearAllMocks();
  });

  describe('execute', () => {
    it('displays header', async () => {
      await command.execute({ component: 'backend' });

      expect(mockLogger.header).toHaveBeenCalledWith('Bootstrap Test Infrastructure');
    });

    it('displays success message on completion', async () => {
      await command.execute({ component: 'backend' });

      expect(mockLogger.success).toHaveBeenCalledWith('Bootstrap complete! Test infrastructure is ready.');
      expect(mockLogger.info).toHaveBeenCalledWith('Run tests to verify setup.');
    });

    it('bootstraps frontend when component is frontend', async () => {
      const frontendPath = path.join(testProjectRoot, 'frontend');
      await mkdir(frontendPath, { recursive: true });

      // Create package.json
      await writeFile(
        path.join(frontendPath, 'package.json'),
        JSON.stringify({ name: 'test-frontend', scripts: {} }, null, 2)
      );

      await command.execute({ component: 'frontend' });

      expect(mockLogger.step).toHaveBeenCalledWith(1, 1, 'Setting up frontend test infrastructure...');
    });

    it('bootstraps backend when component is backend', async () => {
      const backendPath = path.join(testProjectRoot, 'backend');
      await mkdir(backendPath, { recursive: true });

      await command.execute({ component: 'backend' });

      expect(mockLogger.step).toHaveBeenCalledWith(1, 1, 'Setting up backend test infrastructure...');
    });

    it('bootstraps both frontend and backend when component is all', async () => {
      const frontendPath = path.join(testProjectRoot, 'frontend');
      const backendPath = path.join(testProjectRoot, 'backend');
      const infraPath = path.join(testProjectRoot, 'infra');
      await mkdir(frontendPath, { recursive: true });
      await mkdir(backendPath, { recursive: true });
      await mkdir(infraPath, { recursive: true });

      // Create package.json
      await writeFile(
        path.join(frontendPath, 'package.json'),
        JSON.stringify({ name: 'test-frontend', scripts: {} }, null, 2)
      );

      await command.execute({ component: 'all' });

      expect(mockLogger.step).toHaveBeenCalledWith(1, 3, 'Setting up frontend test infrastructure...');
      expect(mockLogger.step).toHaveBeenCalledWith(2, 3, 'Setting up backend test infrastructure...');
      expect(mockLogger.step).toHaveBeenCalledWith(3, 3, 'Setting up infra test infrastructure...');
    });

    it('defaults to all when no component specified', async () => {
      const frontendPath = path.join(testProjectRoot, 'frontend');
      const backendPath = path.join(testProjectRoot, 'backend');
      const infraPath = path.join(testProjectRoot, 'infra');
      await mkdir(frontendPath, { recursive: true });
      await mkdir(backendPath, { recursive: true });
      await mkdir(infraPath, { recursive: true });

      // Create package.json
      await writeFile(
        path.join(frontendPath, 'package.json'),
        JSON.stringify({ name: 'test-frontend', scripts: {} }, null, 2)
      );

      await command.execute();

      expect(mockLogger.step).toHaveBeenCalledWith(1, 3, 'Setting up frontend test infrastructure...');
      expect(mockLogger.step).toHaveBeenCalledWith(2, 3, 'Setting up backend test infrastructure...');
      expect(mockLogger.step).toHaveBeenCalledWith(3, 3, 'Setting up infra test infrastructure...');
    });
  });

  describe('frontend setup', () => {
    beforeEach(async () => {
      const frontendPath = path.join(testProjectRoot, 'frontend');
      await mkdir(frontendPath, { recursive: true });

      // Create package.json
      await writeFile(
        path.join(frontendPath, 'package.json'),
        JSON.stringify({ name: 'test-frontend', scripts: {} }, null, 2)
      );
    });

    it('installs frontend test dependencies', async () => {
      await command.execute({ component: 'frontend' });

      expect(mockLogger.info).toHaveBeenCalledWith('Installing frontend test dependencies...');
      expect(mockLogger.success).toHaveBeenCalledWith('Frontend test dependencies installed');
    });

    it('creates vitest.config.ts', async () => {
      await command.execute({ component: 'frontend' });

      const vitestConfigPath = path.join(testProjectRoot, 'frontend', 'vitest.config.ts');
      expect(fs.existsSync(vitestConfigPath)).toBe(true);

      const content = await readFile(vitestConfigPath, 'utf-8');
      expect(content).toContain('defineConfig');
      expect(content).toContain('jsdom');
      expect(content).toContain('./src/test/setup.ts');
    });

    it('skips vitest.config.ts if it already exists', async () => {
      const vitestConfigPath = path.join(testProjectRoot, 'frontend', 'vitest.config.ts');
      await writeFile(vitestConfigPath, 'existing content');

      await command.execute({ component: 'frontend' });

      const content = await readFile(vitestConfigPath, 'utf-8');
      expect(content).toBe('existing content');
      expect(mockLogger.dim).toHaveBeenCalledWith('vitest.config.ts already exists, skipping');
    });

    it('creates src/test/setup.ts', async () => {
      await command.execute({ component: 'frontend' });

      const setupPath = path.join(testProjectRoot, 'frontend', 'src', 'test', 'setup.ts');
      expect(fs.existsSync(setupPath)).toBe(true);

      const content = await readFile(setupPath, 'utf-8');
      expect(content).toContain('@testing-library/jest-dom/vitest');
      expect(content).toContain('cleanup');
      expect(content).toContain('afterEach');
    });

    it('skips src/test/setup.ts if it already exists', async () => {
      const testDir = path.join(testProjectRoot, 'frontend', 'src', 'test');
      await mkdir(testDir, { recursive: true });
      const setupPath = path.join(testDir, 'setup.ts');
      await writeFile(setupPath, 'existing setup');

      await command.execute({ component: 'frontend' });

      const content = await readFile(setupPath, 'utf-8');
      expect(content).toBe('existing setup');
      expect(mockLogger.dim).toHaveBeenCalledWith('src/test/setup.ts already exists, skipping');
    });

    it('creates src/test/render.tsx', async () => {
      await command.execute({ component: 'frontend' });

      const renderPath = path.join(testProjectRoot, 'frontend', 'src', 'test', 'render.tsx');
      expect(fs.existsSync(renderPath)).toBe(true);

      const content = await readFile(renderPath, 'utf-8');
      expect(content).toContain('QueryClient');
      expect(content).toContain('QueryClientProvider');
      expect(content).toContain('customRender');
    });

    it('skips src/test/render.tsx if it already exists', async () => {
      const testDir = path.join(testProjectRoot, 'frontend', 'src', 'test');
      await mkdir(testDir, { recursive: true });
      const renderPath = path.join(testDir, 'render.tsx');
      await writeFile(renderPath, 'existing render');

      await command.execute({ component: 'frontend' });

      const content = await readFile(renderPath, 'utf-8');
      expect(content).toBe('existing render');
      expect(mockLogger.dim).toHaveBeenCalledWith('src/test/render.tsx already exists, skipping');
    });

    it('creates src/test/mocks/handlers.ts', async () => {
      await command.execute({ component: 'frontend' });

      const handlersPath = path.join(testProjectRoot, 'frontend', 'src', 'test', 'mocks', 'handlers.ts');
      expect(fs.existsSync(handlersPath)).toBe(true);

      const content = await readFile(handlersPath, 'utf-8');
      expect(content).toContain('msw');
      expect(content).toContain('http.post');
      expect(content).toContain('http.get');
      expect(content).toContain('/api/v1/auth/login');
    });

    it('skips src/test/mocks/handlers.ts if it already exists', async () => {
      const mocksDir = path.join(testProjectRoot, 'frontend', 'src', 'test', 'mocks');
      await mkdir(mocksDir, { recursive: true });
      const handlersPath = path.join(mocksDir, 'handlers.ts');
      await writeFile(handlersPath, 'existing handlers');

      await command.execute({ component: 'frontend' });

      const content = await readFile(handlersPath, 'utf-8');
      expect(content).toBe('existing handlers');
      expect(mockLogger.dim).toHaveBeenCalledWith('src/test/mocks/handlers.ts already exists, skipping');
    });

    it('updates package.json scripts', async () => {
      await command.execute({ component: 'frontend' });

      const packageJsonPath = path.join(testProjectRoot, 'frontend', 'package.json');
      const content = await readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(content);

      expect(packageJson.scripts.test).toBe('vitest run');
      expect(packageJson.scripts['test:watch']).toBe('vitest');
      expect(packageJson.scripts['test:coverage']).toBe('vitest run --coverage');
    });

    it('does not overwrite existing test scripts in package.json', async () => {
      const packageJsonPath = path.join(testProjectRoot, 'frontend', 'package.json');
      await writeFile(
        packageJsonPath,
        JSON.stringify({
          name: 'test-frontend',
          scripts: {
            test: 'custom test command',
          },
        }, null, 2)
      );

      await command.execute({ component: 'frontend' });

      const content = await readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(content);

      expect(packageJson.scripts.test).toBe('custom test command'); // Preserved
      expect(packageJson.scripts['test:watch']).toBe('vitest'); // Added
      expect(packageJson.scripts['test:coverage']).toBe('vitest run --coverage'); // Added
    });

    it('skips frontend setup if user enters skip', async () => {
      // Mock prompt to return 'skip'
      vi.spyOn(command as any, 'prompt').mockResolvedValue('skip');

      await command.execute({ component: 'frontend' });

      expect(mockLogger.info).toHaveBeenCalledWith('Skipping frontend setup');
    });

    it('handles npm install failure gracefully', async () => {
      // Mock exec to fail
      vi.mocked(exec).mockImplementation((cmd, options, callback) => {
        if (callback) {
          callback(new Error('npm install failed'), null as any, 'error');
        }
        return {} as any;
      });

      await command.execute({ component: 'frontend' });

      expect(mockLogger.warn).toHaveBeenCalledWith('Failed to install dependencies (may already be installed)');
    });
  });

  describe('backend setup', () => {
    beforeEach(async () => {
      const backendPath = path.join(testProjectRoot, 'backend');
      await mkdir(backendPath, { recursive: true });
    });

    it('handles backend setup (no-op for Go projects)', async () => {
      await command.execute({ component: 'backend' });

      expect(mockLogger.info).toHaveBeenCalledWith('Backend uses Go testing (built-in), no additional setup needed');
      expect(mockLogger.dim).toHaveBeenCalledWith('Ensure tests follow *_test.go naming convention');
    });

    it('skips backend setup if user enters skip', async () => {
      // Mock prompt to return 'skip'
      (command as any).prompt = vi.fn().mockResolvedValue('skip');

      await command.execute({ component: 'backend' });

      expect(mockLogger.info).toHaveBeenCalledWith('Skipping backend setup');
    });
  });

  describe('infra setup', () => {
    beforeEach(async () => {
      const infraPath = path.join(testProjectRoot, 'infra');
      await mkdir(infraPath, { recursive: true });
    });

    it('handles infra setup (no-op for IaC projects)', async () => {
      await command.execute({ component: 'infra' });

      expect(mockLogger.info).toHaveBeenCalledWith('Infra testing typically uses IaC-specific tools');
      expect(mockLogger.dim).toHaveBeenCalledWith('Example: terraform validate && terraform plan');
    });

    it('skips infra setup if user enters skip', async () => {
      // Mock prompt to return 'skip'
      (command as any).prompt = vi.fn().mockResolvedValue('skip');

      await command.execute({ component: 'infra' });

      expect(mockLogger.info).toHaveBeenCalledWith('Skipping infra setup');
    });
  });
});
