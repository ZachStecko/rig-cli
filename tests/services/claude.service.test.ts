import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClaudeService } from '../../src/services/claude.service.js';
import { EventEmitter } from 'events';

// Mock shell exec (used by isInstalled and promptBuffered)
const mockExec = vi.fn();
vi.mock('../../src/utils/shell.js', () => ({
  exec: (...args: any[]) => mockExec(...args),
}));

// Mock child_process spawn (used by run and promptStreaming)
const mockSpawn = vi.fn();
vi.mock('child_process', () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
}));

/**
 * Helper: create a fake ChildProcess for streaming tests.
 */
function createMockChild(opts: { stdout?: string; stderr?: string; exitCode?: number; error?: Error }) {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();

  process.nextTick(() => {
    if (opts.error) {
      child.emit('error', opts.error);
      return;
    }
    if (opts.stdout) child.stdout.emit('data', Buffer.from(opts.stdout));
    if (opts.stderr) child.stderr.emit('data', Buffer.from(opts.stderr));
    child.emit('close', opts.exitCode ?? 0);
  });

  return child;
}

describe('ClaudeService', () => {
  let service: ClaudeService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ClaudeService();
  });

  describe('isInstalled', () => {
    it('returns true when claude --version succeeds', async () => {
      mockExec.mockResolvedValue({ exitCode: 0, stdout: '1.0.0', stderr: '' });
      const result = await service.isInstalled();
      expect(result).toBe(true);
      expect(mockExec).toHaveBeenCalledWith('claude --version');
    });

    it('returns false when claude --version fails', async () => {
      mockExec.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'not found' });
      const result = await service.isInstalled();
      expect(result).toBe(false);
    });
  });

  describe('prompt (buffered, default)', () => {
    let savedClaudeCode: string | undefined;

    beforeEach(() => {
      savedClaudeCode = process.env.CLAUDECODE;
      delete process.env.CLAUDECODE;
    });

    afterEach(() => {
      if (savedClaudeCode !== undefined) {
        process.env.CLAUDECODE = savedClaudeCode;
      }
    });

    it('sends prompt via shell exec and returns text response', async () => {
      const jsonResponse = JSON.stringify({
        content: [{ type: 'text', text: 'Hello world' }],
      });

      mockExec.mockResolvedValue({ exitCode: 0, stdout: jsonResponse, stderr: '' });

      const result = await service.prompt('test prompt');
      expect(result).toBe('Hello world');
      expect(mockExec).toHaveBeenCalledWith(
        'claude -p "test prompt" --output-format json',
        { timeout: 120000 }
      );
    });

    it('throws when in nested Claude session', async () => {
      process.env.CLAUDECODE = '1';
      await expect(service.prompt('test')).rejects.toThrow('nested sessions');
    });

    it('throws when command fails', async () => {
      mockExec.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'error output' });
      await expect(service.prompt('test')).rejects.toThrow('Claude prompt failed');
    });

    it('returns raw stdout when JSON parsing fails', async () => {
      mockExec.mockResolvedValue({ exitCode: 0, stdout: 'raw text', stderr: '' });
      const result = await service.prompt('test');
      expect(result).toBe('raw text');
    });
  });

  describe('prompt (streaming, verbose)', () => {
    let savedClaudeCode: string | undefined;

    beforeEach(() => {
      savedClaudeCode = process.env.CLAUDECODE;
      delete process.env.CLAUDECODE;
    });

    afterEach(() => {
      if (savedClaudeCode !== undefined) {
        process.env.CLAUDECODE = savedClaudeCode;
      }
    });

    it('uses stream-json format and returns accumulated text', async () => {
      const streamLine = JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Hello stream' }] },
      }) + '\n';

      mockSpawn.mockReturnValue(createMockChild({ stdout: streamLine }));

      const result = await service.prompt('test', { verbose: true });
      expect(result).toBe('Hello stream');
      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        ['-p', 'test', '--verbose', '--output-format', 'stream-json'],
        expect.any(Object)
      );
    });

    it('throws on non-zero exit code', async () => {
      mockSpawn.mockReturnValue(createMockChild({ exitCode: 1 }));
      await expect(service.prompt('test', { verbose: true })).rejects.toThrow('Claude prompt failed');
    });

    it('throws on spawn error', async () => {
      mockSpawn.mockReturnValue(createMockChild({ error: new Error('ENOENT') }));
      await expect(service.prompt('test', { verbose: true })).rejects.toThrow('Failed to spawn claude');
    });

    it('throws on timeout', async () => {
      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn(() => {
        process.nextTick(() => child.emit('close', null));
      });

      mockSpawn.mockReturnValue(child);

      await expect(service.prompt('test', { verbose: true, timeoutMs: 50 })).rejects.toThrow('timed out');
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    });
  });

  describe('run', () => {
    it('spawns claude with correct arguments', async () => {
      const mockChild = { stdout: null, stderr: null };
      mockSpawn.mockReturnValue(mockChild);

      await service.run({
        prompt: 'test prompt',
        maxTurns: 10,
        allowedTools: 'Read,Write',
        logFile: '/tmp/test.log',
        permissionMode: 'bypassPermissions',
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining([
          '-p', 'test prompt',
          '--max-turns', '10',
          '--allowedTools', 'Read,Write',
          '--permission-mode', 'bypassPermissions',
          '--verbose',
          '--output-format', 'stream-json',
        ]),
        expect.objectContaining({
          stdio: ['ignore', 'pipe', 'pipe'],
          env: expect.objectContaining({
            CLAUDE_LOG_FILE: '/tmp/test.log',
          }),
        })
      );
    });

    it('omits permission-mode flag when not specified', async () => {
      const mockChild = { stdout: null, stderr: null };
      mockSpawn.mockReturnValue(mockChild);

      await service.run({
        prompt: 'test',
        maxTurns: 5,
        allowedTools: 'Read',
        logFile: '/tmp/test.log',
      });

      const args = mockSpawn.mock.calls[0][1];
      expect(args).not.toContain('--permission-mode');
    });
  });
});
