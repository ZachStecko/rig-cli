import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ClaudeService } from '../../src/services/claude.service.js';
import * as shell from '../../src/utils/shell.js';
import * as child_process from 'child_process';
import { EventEmitter } from 'events';

// Mock the shell module
vi.mock('../../src/utils/shell.js', () => ({
  exec: vi.fn(),
}));

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

describe('ClaudeService', () => {
  let claudeService: ClaudeService;
  const mockExec = vi.mocked(shell.exec);
  const mockSpawn = vi.mocked(child_process.spawn);

  beforeEach(() => {
    claudeService = new ClaudeService();
    mockExec.mockClear();
    mockSpawn.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('isInstalled', () => {
    it('returns true when claude is installed', async () => {
      mockExec.mockResolvedValue({
        stdout: 'claude version 1.0.0\n',
        stderr: '',
        exitCode: 0,
      });

      const result = await claudeService.isInstalled();

      expect(result).toBe(true);
      expect(mockExec).toHaveBeenCalledWith('claude --version');
    });

    it('returns false when claude is not installed', async () => {
      mockExec.mockResolvedValue({
        stdout: '',
        stderr: 'command not found: claude',
        exitCode: 127,
      });

      const result = await claudeService.isInstalled();

      expect(result).toBe(false);
    });

    it('returns false when claude command fails', async () => {
      mockExec.mockResolvedValue({
        stdout: '',
        stderr: 'error',
        exitCode: 1,
      });

      const result = await claudeService.isInstalled();

      expect(result).toBe(false);
    });
  });

  describe('run', () => {
    it('spawns claude with correct arguments', async () => {
      const mockChild = new EventEmitter() as any;
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      mockSpawn.mockReturnValue(mockChild);

      const options = {
        prompt: 'Fix the bug in authentication',
        maxTurns: 80,
        allowedTools: 'Read,Write,Bash',
        logFile: '/path/to/log.txt',
      };

      await claudeService.run(options);

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        [
          '-p',
          'Fix the bug in authentication',
          '--max-turns',
          '80',
          '--allowedTools',
          'Read,Write,Bash',
          '--verbose',
          '--output-format',
          'stream-json',
        ],
        expect.objectContaining({
          stdio: ['ignore', 'pipe', 'pipe'],
          env: expect.objectContaining({
            CLAUDE_LOG_FILE: '/path/to/log.txt',
          }),
        })
      );
    });

    it('returns the spawned child process', async () => {
      const mockChild = new EventEmitter() as any;
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      mockSpawn.mockReturnValue(mockChild);

      const options = {
        prompt: 'Test prompt',
        maxTurns: 50,
        allowedTools: 'Read,Write',
        logFile: '/tmp/log.txt',
      };

      const result = await claudeService.run(options);

      expect(result).toBe(mockChild);
    });

    it('converts maxTurns to string', async () => {
      const mockChild = new EventEmitter() as any;
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      mockSpawn.mockReturnValue(mockChild);

      const options = {
        prompt: 'Test',
        maxTurns: 100,
        allowedTools: 'Read',
        logFile: '/tmp/log.txt',
      };

      await claudeService.run(options);

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['--max-turns', '100']),
        expect.any(Object)
      );
    });

    it('passes environment variables including CLAUDE_LOG_FILE', async () => {
      const mockChild = new EventEmitter() as any;
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      mockSpawn.mockReturnValue(mockChild);

      const options = {
        prompt: 'Test',
        maxTurns: 80,
        allowedTools: 'Read,Write,Bash',
        logFile: '/var/log/claude.log',
      };

      await claudeService.run(options);

      const spawnCall = mockSpawn.mock.calls[0];
      const spawnOptions = spawnCall[2];

      expect(spawnOptions.env).toBeDefined();
      expect(spawnOptions.env.CLAUDE_LOG_FILE).toBe('/var/log/claude.log');
    });

    it('includes existing environment variables', async () => {
      const mockChild = new EventEmitter() as any;
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      mockSpawn.mockReturnValue(mockChild);

      const originalPath = process.env.PATH;

      const options = {
        prompt: 'Test',
        maxTurns: 80,
        allowedTools: 'Read',
        logFile: '/tmp/log.txt',
      };

      await claudeService.run(options);

      const spawnCall = mockSpawn.mock.calls[0];
      const spawnOptions = spawnCall[2];

      expect(spawnOptions.env.PATH).toBe(originalPath);
    });

    it('sets stdio to ignore stdin and pipe stdout/stderr', async () => {
      const mockChild = new EventEmitter() as any;
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      mockSpawn.mockReturnValue(mockChild);

      const options = {
        prompt: 'Test',
        maxTurns: 80,
        allowedTools: 'Read',
        logFile: '/tmp/log.txt',
      };

      await claudeService.run(options);

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        expect.any(Array),
        expect.objectContaining({
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      );
    });

    it('uses stream-json output format', async () => {
      const mockChild = new EventEmitter() as any;
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      mockSpawn.mockReturnValue(mockChild);

      const options = {
        prompt: 'Test',
        maxTurns: 80,
        allowedTools: 'Read',
        logFile: '/tmp/log.txt',
      };

      await claudeService.run(options);

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['--output-format', 'stream-json']),
        expect.any(Object)
      );
    });

    it('enables verbose mode', async () => {
      const mockChild = new EventEmitter() as any;
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      mockSpawn.mockReturnValue(mockChild);

      const options = {
        prompt: 'Test',
        maxTurns: 80,
        allowedTools: 'Read',
        logFile: '/tmp/log.txt',
      };

      await claudeService.run(options);

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['--verbose']),
        expect.any(Object)
      );
    });
  });
});
