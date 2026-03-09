import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '../../src/services/logger.js';
import chalk from 'chalk';

describe('Logger', () => {
  let logger: Logger;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logger = new Logger();
    // Spy on console methods to capture output
    stdoutSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore console methods after each test
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  describe('info', () => {
    it('prints message in blue to stdout', () => {
      logger.info('Test info message');
      expect(stdoutSpy).toHaveBeenCalledWith(chalk.blue('Test info message'));
      expect(stdoutSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('success', () => {
    it('prints message in green with checkmark to stdout', () => {
      logger.success('Operation completed');
      expect(stdoutSpy).toHaveBeenCalledWith(chalk.green('✓ Operation completed'));
      expect(stdoutSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('warn', () => {
    it('prints message in yellow with warning symbol to stdout', () => {
      logger.warn('This is a warning');
      expect(stdoutSpy).toHaveBeenCalledWith(chalk.yellow('⚠ This is a warning'));
      expect(stdoutSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('error', () => {
    it('prints message in red with X symbol to stderr', () => {
      logger.error('Something went wrong');
      expect(stderrSpy).toHaveBeenCalledWith(chalk.red('✗ Something went wrong'));
      expect(stderrSpy).toHaveBeenCalledTimes(1);
      // Verify it doesn't go to stdout
      expect(stdoutSpy).not.toHaveBeenCalled();
    });
  });

  describe('header', () => {
    it('prints bold cyan message with newline prefix to stdout', () => {
      logger.header('Running Tests');
      expect(stdoutSpy).toHaveBeenCalledWith(chalk.cyan.bold('\nRunning Tests'));
      expect(stdoutSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('step', () => {
    it('prints progress indicator with step numbers', () => {
      logger.step(2, 5, 'Running tests');
      expect(stdoutSpy).toHaveBeenCalledWith(chalk.dim('[2/5]') + ' Running tests');
      expect(stdoutSpy).toHaveBeenCalledTimes(1);
    });

    it('formats different step numbers correctly', () => {
      logger.step(1, 10, 'First step');
      expect(stdoutSpy).toHaveBeenCalledWith(chalk.dim('[1/10]') + ' First step');
    });
  });

  describe('dim', () => {
    it('prints dimmed message to stdout', () => {
      logger.dim('Less important info');
      expect(stdoutSpy).toHaveBeenCalledWith(chalk.dim('Less important info'));
      expect(stdoutSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('spinner', () => {
    it('resolves with promise result and stops spinner', async () => {
      const mockPromise = Promise.resolve('success result');
      const result = await logger.spinner(mockPromise, 'Loading...');
      expect(result).toBe('success result');
    });

    it('rejects when promise fails and shows fail state', async () => {
      const mockError = new Error('Test error');
      const mockPromise = Promise.reject(mockError);

      await expect(logger.spinner(mockPromise, 'Loading...')).rejects.toThrow('Test error');
    });

    it('handles async operations with delays', async () => {
      const mockPromise = new Promise<string>((resolve) => {
        setTimeout(() => resolve('delayed result'), 10);
      });

      const result = await logger.spinner(mockPromise, 'Processing...');
      expect(result).toBe('delayed result');
    });
  });
});
