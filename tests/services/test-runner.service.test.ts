import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TestRunnerService } from '../../src/services/test-runner.service.js';
import { GitService } from '../../src/services/git.service.js';
import * as shell from '../../src/utils/shell.js';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';

// Mock modules
vi.mock('../../src/utils/shell.js');
vi.mock('fs');
vi.mock('fs/promises');

describe('TestRunnerService', () => {
  let testRunner: TestRunnerService;
  let mockGit: GitService;
  let mockConfig: any;
  let mockLogger: any;
  let mockExec: ReturnType<typeof vi.fn>;
  let mockExistsSync: ReturnType<typeof vi.fn>;
  let mockReadFile: ReturnType<typeof vi.fn>;
  const projectRoot = '/test/project';

  beforeEach(() => {
    mockExec = vi.fn();
    mockExistsSync = vi.fn();
    mockReadFile = vi.fn();

    vi.mocked(shell.exec).mockImplementation(mockExec);
    vi.mocked(fs.existsSync).mockImplementation(mockExistsSync);
    vi.mocked(fsPromises.readFile).mockImplementation(mockReadFile);

    mockGit = {
      newFilesVsMaster: vi.fn(),
    } as any;

    mockConfig = {
      get: vi.fn().mockReturnValue({
        components: {
          backend: {
            path: 'backend',
            test_command: 'go test ./...',
          },
          frontend: {
            path: 'frontend',
            test_command: 'npm test',
          },
        },
      }),
    };

    mockLogger = {
      config: vi.fn(),
      timing: vi.fn(),
      command: vi.fn(),
    };

    testRunner = new TestRunnerService(projectRoot, mockGit, mockConfig, mockLogger);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('runBackendLint', () => {
    it('skips when backend directory does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      const result = await testRunner.runBackendLint();

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(mockExec).not.toHaveBeenCalled();
    });

    it('uses golangci-lint when available', async () => {
      mockExistsSync.mockReturnValue(true);

      // which golangci-lint succeeds
      mockExec.mockResolvedValueOnce({
        stdout: '/usr/bin/golangci-lint',
        stderr: '',
        exitCode: 0,
      });

      // golangci-lint run --fix succeeds
      mockExec.mockResolvedValueOnce({
        stdout: 'Fixed 2 issues',
        stderr: '',
        exitCode: 0,
      });

      // git add succeeds
      mockExec.mockResolvedValueOnce({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      // golangci-lint run succeeds
      mockExec.mockResolvedValueOnce({
        stdout: 'All checks passed',
        stderr: '',
        exitCode: 0,
      });

      const result = await testRunner.runBackendLint();

      expect(result.success).toBe(true);
      expect(result.output).toContain('All checks passed');
      expect(mockExec).toHaveBeenCalledWith('which golangci-lint');
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('golangci-lint run --fix')
      );
    });

    it('falls back to go vet when golangci-lint not available', async () => {
      mockExistsSync.mockReturnValue(true);

      // which golangci-lint fails
      mockExec.mockResolvedValueOnce({
        stdout: '',
        stderr: 'not found',
        exitCode: 1,
      });

      // go vet succeeds
      mockExec.mockResolvedValueOnce({
        stdout: 'No issues found',
        stderr: '',
        exitCode: 0,
      });

      const result = await testRunner.runBackendLint();

      expect(result.success).toBe(true);
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('go vet ./...'),
      );
    });

    it('returns failure when linting fails', async () => {
      mockExistsSync.mockReturnValue(true);

      mockExec.mockResolvedValueOnce({
        stdout: '',
        stderr: 'not found',
        exitCode: 1,
      });

      mockExec.mockResolvedValueOnce({
        stdout: '',
        stderr: 'vet: undefined: Foo',
        exitCode: 1,
      });

      const result = await testRunner.runBackendLint();

      expect(result.success).toBe(false);
      expect(result.output).toContain('undefined: Foo');
    });
  });

  describe('runBackendBuild', () => {
    it('skips when backend directory does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      const result = await testRunner.runBackendBuild();

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
    });

    it('runs go build successfully', async () => {
      mockExistsSync.mockReturnValue(true);

      mockExec.mockResolvedValueOnce({
        stdout: 'Build complete',
        stderr: '',
        exitCode: 0,
      });

      const result = await testRunner.runBackendBuild();

      expect(result.success).toBe(true);
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('go build ./...'),
      );
    });

    it('returns failure when build fails', async () => {
      mockExistsSync.mockReturnValue(true);

      mockExec.mockResolvedValueOnce({
        stdout: '',
        stderr: 'undefined: Foo',
        exitCode: 1,
      });

      const result = await testRunner.runBackendBuild();

      expect(result.success).toBe(false);
      expect(result.output).toContain('undefined: Foo');
    });
  });

  describe('runBackendTests', () => {
    it('skips when backend directory does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      const result = await testRunner.runBackendTests();

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
    });

    it('runs go test successfully', async () => {
      mockExistsSync.mockReturnValue(true);

      mockExec.mockResolvedValueOnce({
        stdout: 'PASS\nok  \tpkg/foo\t0.123s\n',
        stderr: '',
        exitCode: 0,
      });

      const result = await testRunner.runBackendTests();

      expect(result.success).toBe(true);
      expect(result.output).toContain('PASS');
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('go test ./...'),
      );
    });

    it('returns failure when tests fail', async () => {
      mockExistsSync.mockReturnValue(true);

      mockExec.mockResolvedValueOnce({
        stdout: 'FAIL\tpkg/foo\t0.123s',
        stderr: '',
        exitCode: 1,
      });

      const result = await testRunner.runBackendTests();

      expect(result.success).toBe(false);
      expect(result.output).toContain('FAIL');
    });
  });

  describe('runFrontendLint', () => {
    it('skips when frontend directory does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      const result = await testRunner.runFrontendLint();

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
    });

    it('runs eslint fix and npm run lint successfully', async () => {
      mockExistsSync.mockReturnValue(true);

      // eslint --fix
      mockExec.mockResolvedValueOnce({
        stdout: 'Fixed 3 files',
        stderr: '',
        exitCode: 0,
      });

      // git add
      mockExec.mockResolvedValueOnce({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      // npm run lint
      mockExec.mockResolvedValueOnce({
        stdout: 'All files passed',
        stderr: '',
        exitCode: 0,
      });

      const result = await testRunner.runFrontendLint();

      expect(result.success).toBe(true);
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('npx eslint --fix'),
      );
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('npm run lint'),
      );
    });

    it('returns failure when lint fails', async () => {
      mockExistsSync.mockReturnValue(true);

      mockExec.mockResolvedValueOnce({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      mockExec.mockResolvedValueOnce({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      mockExec.mockResolvedValueOnce({
        stdout: '',
        stderr: 'src/App.tsx: Unexpected console statement',
        exitCode: 1,
      });

      const result = await testRunner.runFrontendLint();

      expect(result.success).toBe(false);
      expect(result.output).toContain('Unexpected console statement');
    });
  });

  describe('runFrontendBuild', () => {
    it('skips when frontend directory does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      const result = await testRunner.runFrontendBuild();

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
    });

    it('runs npm run build successfully', async () => {
      mockExistsSync.mockReturnValue(true);

      mockExec.mockResolvedValueOnce({
        stdout: 'Build complete. Files written to dist/',
        stderr: '',
        exitCode: 0,
      });

      const result = await testRunner.runFrontendBuild();

      expect(result.success).toBe(true);
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('npm run build'),
      );
    });

    it('returns failure when build fails', async () => {
      mockExistsSync.mockReturnValue(true);

      mockExec.mockResolvedValueOnce({
        stdout: '',
        stderr: 'TS2304: Cannot find name "Foo"',
        exitCode: 1,
      });

      const result = await testRunner.runFrontendBuild();

      expect(result.success).toBe(false);
      expect(result.output).toContain('Cannot find name "Foo"');
    });
  });

  describe('runFrontendTests', () => {
    it('skips when frontend directory does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      const result = await testRunner.runFrontendTests();

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
    });

    it('skips when package.json does not exist', async () => {
      mockExistsSync.mockReturnValueOnce(true); // frontend dir exists
      mockExistsSync.mockReturnValueOnce(false); // package.json doesn't

      const result = await testRunner.runFrontendTests();

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(result.output).toContain('No package.json');
    });

    it('skips when test script does not exist', async () => {
      mockExistsSync.mockReturnValue(true);

      mockReadFile.mockResolvedValue(
        JSON.stringify({
          scripts: {
            build: 'vite build',
          },
        })
      );

      const result = await testRunner.runFrontendTests();

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(result.output).toContain('No test script');
    });

    it('runs npm test successfully', async () => {
      mockExistsSync.mockReturnValue(true);

      mockReadFile.mockResolvedValue(
        JSON.stringify({
          scripts: {
            test: 'vitest run',
          },
        })
      );

      mockExec.mockResolvedValueOnce({
        stdout: '✓ 25 tests passed',
        stderr: '',
        exitCode: 0,
      });

      const result = await testRunner.runFrontendTests();

      expect(result.success).toBe(true);
      expect(result.output).toContain('25 tests passed');
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('npm test'),
      );
    });

    it('returns failure when tests fail', async () => {
      mockExistsSync.mockReturnValue(true);

      mockReadFile.mockResolvedValue(
        JSON.stringify({
          scripts: {
            test: 'vitest run',
          },
        })
      );

      mockExec.mockResolvedValueOnce({
        stdout: '✗ 2 tests failed',
        stderr: '',
        exitCode: 1,
      });

      const result = await testRunner.runFrontendTests();

      expect(result.success).toBe(false);
      expect(result.output).toContain('2 tests failed');
    });
  });

  describe('runDevnetTests', () => {
    it('skips when devnet directory does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      const result = await testRunner.runDevnetTests();

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
    });

    it('skips when package.json does not exist', async () => {
      mockExistsSync.mockReturnValueOnce(true); // devnet dir exists
      mockExistsSync.mockReturnValueOnce(false); // package.json doesn't

      const result = await testRunner.runDevnetTests();

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(result.output).toContain('No devnet/package.json');
    });

    it('runs npx vitest run successfully', async () => {
      mockExistsSync.mockReturnValue(true);

      mockExec.mockResolvedValueOnce({
        stdout: '✓ 10 tests passed',
        stderr: '',
        exitCode: 0,
      });

      const result = await testRunner.runDevnetTests();

      expect(result.success).toBe(true);
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('npx vitest run'),
      );
    });

    it('returns failure when tests fail', async () => {
      mockExistsSync.mockReturnValue(true);

      mockExec.mockResolvedValueOnce({
        stdout: '',
        stderr: 'Test failed',
        exitCode: 1,
      });

      const result = await testRunner.runDevnetTests();

      expect(result.success).toBe(false);
    });
  });

  describe('checkTestCoverage', () => {
    it('succeeds when no new files added', async () => {
      vi.mocked(mockGit.newFilesVsMaster).mockResolvedValue([]);

      const result = await testRunner.checkTestCoverage('backend');

      expect(result.success).toBe(true);
      expect(result.output).toContain('No new files');
    });

    it('succeeds when all Go files have tests', async () => {
      vi.mocked(mockGit.newFilesVsMaster).mockResolvedValue([
        'backend/pkg/foo.go',
        'backend/pkg/foo_test.go',
      ]);

      const result = await testRunner.checkTestCoverage('backend');

      expect(result.success).toBe(true);
      expect(result.output).toContain('test coverage');
    });

    it('fails when Go file missing test', async () => {
      vi.mocked(mockGit.newFilesVsMaster).mockResolvedValue(['backend/pkg/foo.go']);

      mockExistsSync.mockReturnValue(false);

      const result = await testRunner.checkTestCoverage('backend');

      expect(result.success).toBe(false);
      expect(result.output).toContain('backend/pkg/foo.go');
      expect(result.output).toContain('backend/pkg/foo_test.go');
    });

    it('succeeds when all TypeScript files have tests', async () => {
      vi.mocked(mockGit.newFilesVsMaster).mockResolvedValue([
        'frontend/src/App.tsx',
        'frontend/src/App.test.tsx',
      ]);

      const result = await testRunner.checkTestCoverage('frontend');

      expect(result.success).toBe(true);
    });

    it('fails when TypeScript file missing test', async () => {
      vi.mocked(mockGit.newFilesVsMaster).mockResolvedValue(['frontend/src/App.tsx']);

      mockExistsSync.mockReturnValue(false);

      const result = await testRunner.checkTestCoverage('frontend');

      expect(result.success).toBe(false);
      expect(result.output).toContain('frontend/src/App.tsx');
      expect(result.output).toContain('frontend/src/App.test.tsx');
    });

    it('skips test files themselves', async () => {
      vi.mocked(mockGit.newFilesVsMaster).mockResolvedValue([
        'backend/pkg/foo_test.go',
        'frontend/src/App.test.tsx',
      ]);

      const result = await testRunner.checkTestCoverage('fullstack');

      expect(result.success).toBe(true);
    });

    it('skips config files', async () => {
      vi.mocked(mockGit.newFilesVsMaster).mockResolvedValue([
        'frontend/vite.config.ts',
        'backend/config.yaml',
      ]);

      const result = await testRunner.checkTestCoverage('fullstack');

      expect(result.success).toBe(true);
    });

    it('skips type definition files', async () => {
      vi.mocked(mockGit.newFilesVsMaster).mockResolvedValue([
        'frontend/src/types/index.d.ts',
        'frontend/src/types/api.ts',
      ]);

      const result = await testRunner.checkTestCoverage('frontend');

      expect(result.success).toBe(true);
    });

    it('skips migration files', async () => {
      vi.mocked(mockGit.newFilesVsMaster).mockResolvedValue([
        'backend/migrations/001_create_users.sql',
      ]);

      const result = await testRunner.checkTestCoverage('backend');

      expect(result.success).toBe(true);
    });
  });

  describe('listNewTestFiles', () => {
    it('returns empty array when no new test files', async () => {
      vi.mocked(mockGit.newFilesVsMaster).mockResolvedValue([
        'backend/pkg/foo.go',
        'frontend/src/App.tsx',
      ]);

      const result = await testRunner.listNewTestFiles();

      expect(result).toEqual([]);
    });

    it('returns Go test files', async () => {
      vi.mocked(mockGit.newFilesVsMaster).mockResolvedValue([
        'backend/pkg/foo.go',
        'backend/pkg/foo_test.go',
        'backend/pkg/bar_test.go',
      ]);

      const result = await testRunner.listNewTestFiles();

      expect(result).toEqual(['backend/pkg/foo_test.go', 'backend/pkg/bar_test.go']);
    });

    it('returns TypeScript test files', async () => {
      vi.mocked(mockGit.newFilesVsMaster).mockResolvedValue([
        'frontend/src/App.tsx',
        'frontend/src/App.test.tsx',
        'frontend/src/utils.test.ts',
      ]);

      const result = await testRunner.listNewTestFiles();

      expect(result).toEqual(['frontend/src/App.test.tsx', 'frontend/src/utils.test.ts']);
    });

    it('returns spec files', async () => {
      vi.mocked(mockGit.newFilesVsMaster).mockResolvedValue([
        'frontend/src/Component.spec.tsx',
      ]);

      const result = await testRunner.listNewTestFiles();

      expect(result).toEqual(['frontend/src/Component.spec.tsx']);
    });
  });

  describe('runAllTests', () => {
    beforeEach(() => {
      mockExistsSync.mockReturnValue(true);
      mockExec.mockResolvedValue({
        stdout: 'Success',
        stderr: '',
        exitCode: 0,
      });
      mockReadFile.mockResolvedValue(JSON.stringify({ scripts: { test: 'vitest' } }));
      vi.mocked(mockGit.newFilesVsMaster).mockResolvedValue([]);
    });

    it('runs only devnet tests for devnet component', async () => {
      const result = await testRunner.runAllTests('devnet');

      expect(result.success).toBe(true);
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('npx vitest run'),
      );
    });

    it('runs backend tests for backend component', async () => {
      const result = await testRunner.runAllTests('backend');

      expect(result.success).toBe(true);
      // Should run lint, build, test
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('go build'),
      );
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('go test'),
      );
    });

    it('runs frontend tests for frontend component', async () => {
      const result = await testRunner.runAllTests('frontend');

      expect(result.success).toBe(true);
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('npm run lint'),
      );
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('npm run build'),
      );
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('npm test'),
      );
    });

    it('runs both backend and frontend for fullstack component', async () => {
      const result = await testRunner.runAllTests('fullstack');

      expect(result.success).toBe(true);
      // Should run both backend and frontend tests
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('go test')
      );
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('npm test')
      );
    });

    it('returns failure when any test fails', async () => {
      // Make backend tests fail
      mockExec.mockImplementation(async (cmd: string) => {
        if (cmd.includes('go test')) {
          return { stdout: '', stderr: 'Test failed', exitCode: 1 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      });

      const result = await testRunner.runAllTests('backend');

      expect(result.success).toBe(false);
    });
  });
});
