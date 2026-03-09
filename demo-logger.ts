#!/usr/bin/env tsx
/**
 * Visual demo of the logger service.
 * Run with: npm run demo-logger
 */
import { Logger } from './src/services/logger.js';

const logger = new Logger();

async function demo() {
  console.log('\n=== Logger Visual Demo ===\n');

  logger.header('Logger Service Demo');

  logger.info('This is an informational message (should be blue)');
  logger.success('This is a success message (should be green with ✓)');
  logger.warn('This is a warning message (should be yellow with ⚠)');
  logger.error('This is an error message (should be red with ✗)');
  logger.dim('This is dimmed/muted text (should be gray)');

  logger.header('Progress Steps');
  logger.step(1, 5, 'Fetching issues from GitHub');
  logger.step(2, 5, 'Creating branch');
  logger.step(3, 5, 'Running implementation');
  logger.step(4, 5, 'Running tests');
  logger.step(5, 5, 'Creating pull request');

  logger.header('Spinner Demo');
  await logger.spinner(
    new Promise(resolve => setTimeout(resolve, 1000)),
    'Loading data (1 second)...'
  );
  logger.success('Spinner completed!');

  console.log('\n=== End of Demo ===\n');
}

demo().catch(console.error);
