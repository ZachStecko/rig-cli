import { BaseCommand } from './base-command.js';
import { Logger } from '../services/logger.service.js';
import { ConfigManager } from '../services/config-manager.service.js';
import { StateManager } from '../services/state-manager.service.js';
import { GitService } from '../services/git.service.js';
import { GitHubService } from '../services/github.service.js';
import { GuardService } from '../services/guard.service.js';
import * as readline from 'readline';

/**
 * ResetCommand aborts the current pipeline and cleans up state.
 *
 * Prompts for confirmation before checking out the default branch
 * and deleting pipeline state. This is the "escape hatch" for abandoning work.
 */
export class ResetCommand extends BaseCommand {
  /**
   * Executes the reset command.
   *
   * Checks for active pipeline, prompts for confirmation, then resets to default branch
   * and deletes state.
   */
  async execute(): Promise<void> {
    // Check if there's an active pipeline
    const stateExists = await this.state.exists();

    if (!stateExists) {
      this.logger.warn("No active pipeline to reset. Run 'rig next' to start.");
      return;
    }

    // Load current state
    const state = await this.state.read();

    // Display what will be reset
    this.logger.header('Reset Pipeline');
    console.log('');
    this.logger.warn('This will abort the current pipeline and delete all state.');
    console.log('');
    this.logger.info(`Issue: #${state.issue_number} - ${state.issue_title}`);
    this.logger.info(`Current stage: ${state.stage}`);
    this.logger.info(`Branch: ${state.branch}`);
    console.log('');

    // Check for uncommitted changes
    const isClean = await this.git.isClean();
    if (!isClean) {
      this.logger.warn('Uncommitted changes detected. These will be lost if not stashed.');
      console.log('');
    }

    // Prompt for confirmation
    const confirmed = await this.confirm('Are you sure you want to reset? (y/N): ');

    if (!confirmed) {
      this.logger.info('Reset cancelled.');
      return;
    }

    // Checkout default branch (main/master)
    try {
      await this.git.checkoutMaster();
      const currentBranch = await this.git.currentBranch();
      this.logger.success(`Checked out ${currentBranch}`);
    } catch (error) {
      this.logger.error(`Failed to checkout default branch: ${(error as Error).message}`);
      this.logger.dim('Hint: Stash or commit changes first with: git stash');
      process.exit(1);
      return; // For testing
    }

    // Clean up issue-specific logs and reviews
    await this.cleanupIssueFiles(state.issue_number);

    // Delete state file
    await this.state.delete();

    this.logger.success('Pipeline reset complete.');
    this.logger.dim(`Branch '${state.branch}' still exists locally. Delete with: git branch -D ${state.branch}`);
    this.logger.dim('State cleared. Run \'rig next\' to start a new pipeline.');
  }

  /**
   * Cleans up issue-specific log and review files.
   *
   * @param issueNumber - Issue number to clean up
   */
  private async cleanupIssueFiles(issueNumber: number): Promise<void> {
    const fs = await import('fs/promises');
    const path = await import('path');

    try {
      // Clean up log file: .rig-logs/issue-{number}.log
      const logFile = path.join(this.projectRoot || process.cwd(), '.rig-logs', `issue-${issueNumber}.log`);
      await fs.unlink(logFile).catch(() => {}); // Ignore if doesn't exist

      // Clean up review directory: .rig-reviews/issue-{number}/
      const reviewDir = path.join(this.projectRoot || process.cwd(), '.rig-reviews', `issue-${issueNumber}`);
      await fs.rm(reviewDir, { recursive: true, force: true }).catch(() => {}); // Ignore if doesn't exist
    } catch (error) {
      // Silently ignore cleanup errors - not critical
    }
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
