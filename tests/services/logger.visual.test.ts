import { describe, it } from 'vitest';
import { Logger } from '../../src/services/logger.js';

/**
 * Visual confirmation tests - these actually output to the terminal
 * so you can see the logger formatting in action.
 *
 * These tests don't make assertions, they just demonstrate the output.
 */
describe('Logger - Visual Confirmation', () => {
  const logger = new Logger();

  it('displays all logger output styles', async () => {
    console.log('\n--- Logger Visual Output Test ---\n');

    logger.header('Logger Service Demo');

    logger.info('This is an informational message');
    logger.success('This is a success message');
    logger.warn('This is a warning message');
    logger.error('This is an error message');
    logger.dim('This is dimmed/muted text');

    logger.header('Progress Steps');
    logger.step(1, 5, 'Fetching issues from GitHub');
    logger.step(2, 5, 'Creating branch');
    logger.step(3, 5, 'Running implementation');
    logger.step(4, 5, 'Running tests');
    logger.step(5, 5, 'Creating pull request');

    logger.header('Spinner Demo');
    await logger.spinner(
      new Promise(resolve => setTimeout(resolve, 500)),
      'Loading data...'
    );
    logger.success('Spinner completed successfully');

    console.log('\n--- End of Visual Test ---\n');
  });
});
