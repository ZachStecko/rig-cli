import { BaseCommand } from './base-command.js';

/**
 * RollbackCommand completely undoes all work done for the current issue.
 *
 * This command:
 * - Deletes the feature branch (locally and remotely if pushed)
 * - Optionally closes any open PRs for this branch
 * - Returns to main/master branch
 * - Cleans up logs, reviews, and demos
 * - Clears pipeline state
 *
 * This is more destructive than `rig reset` which only clears state.
 */
export class RollbackCommand extends BaseCommand {
  /**
   * Executes the rollback command.
   *
   * Prompts for confirmation, then:
   * 1. Closes any open PRs (optional)
   * 2. Deletes feature branch (local and remote)
   * 3. Checks out master/main
   * 4. Cleans up issue files
   * 5. Deletes state
   */
  async execute(options: { 'close-pr'?: boolean } = {}): Promise<void> {
    // Check if there's an active pipeline
    const stateExists = await this.state.exists();

    if (!stateExists) {
      this.logger.warn("No active pipeline to rollback. Run 'rig next' to start.");
      return;
    }

    // Load current state
    const state = await this.state.read();

    // Validate branch name from state
    const validBranchPattern = /^[a-zA-Z0-9/_.-]+$/;
    if (!state.branch || !validBranchPattern.test(state.branch) || state.branch.startsWith('-')) {
      this.logger.error(`Invalid branch name in state: "${state.branch}"`);
      this.logger.dim('State may be corrupted. Consider running: rig reset');
      process.exit(1);
      return; // For testing
    }

    // Display what will be rolled back
    this.logger.header('Rollback Pipeline');
    console.log('');
    this.logger.warn('This will completely undo all work done for this issue.');
    console.log('');
    this.logger.info(`Issue: #${state.issue_number} - ${state.issue_title}`);
    this.logger.info(`Current stage: ${state.stage}`);
    this.logger.info(`Branch: ${state.branch}`);
    console.log('');

    // Check for uncommitted changes
    try {
      const isClean = await this.git.isClean();
      if (!isClean) {
        this.logger.warn('Uncommitted changes detected. These will be lost.');
        console.log('');
      }
    } catch (error) {
      this.logger.warn(`Could not check for uncommitted changes: ${(error as Error).message}`);
      console.log('');
    }

    // Check if branch was pushed (check regardless of current branch)
    let branchPushed = false;
    try {
      branchPushed = await this.git.remoteBranchExists(state.branch);
      if (branchPushed) {
        this.logger.warn('Branch has been pushed to remote. It will be deleted remotely.');
      }
    } catch (error) {
      this.logger.warn(`Could not check remote branch: ${(error as Error).message}`);
      this.logger.dim('Will attempt local branch deletion only');
    }

    // Check for open PRs
    let openPrs: Array<{ number: number; title: string }> = [];
    try {
      openPrs = await this.github.prListByHead(state.branch);
    } catch (error) {
      this.logger.warn(`Could not check for open PRs: ${(error as Error).message}`);
      this.logger.dim('PRs will not be automatically closed');
    }

    const closePr = options['close-pr'] !== false && openPrs.length > 0;

    if (closePr) {
      if (openPrs.length === 1) {
        this.logger.warn(`Open PR #${openPrs[0].number} will be closed.`);
      } else {
        this.logger.warn(`${openPrs.length} open PRs will be closed: ${openPrs.map(pr => `#${pr.number}`).join(', ')}`);
      }
    }

    console.log('');

    // Prompt for confirmation
    const confirmed = await this.confirm('Are you sure you want to rollback? (y/N): ');

    if (!confirmed) {
      this.logger.info('Rollback cancelled.');
      return;
    }

    console.log('');

    // Step 1: Close any open PRs if requested
    if (closePr && openPrs.length > 0) {
      for (const pr of openPrs) {
        try {
          this.logger.info(`Closing PR #${pr.number}...`);
          await this.github.closePr(
            pr.number,
            `Automated rollback via rig-cli for issue #${state.issue_number}`
          );
          this.logger.success(`PR #${pr.number} closed`);
        } catch (error) {
          this.logger.warn(`Failed to close PR #${pr.number}: ${(error as Error).message}`);
          this.logger.dim(`You may need to close PR #${pr.number} manually`);
        }
      }
      console.log('');
    }

    // Step 2: Checkout master/main branch
    let checkoutFailed = false;
    try {
      await this.git.checkoutMaster();
      const newBranch = await this.git.currentBranch();
      this.logger.success(`Checked out ${newBranch}`);
    } catch (error) {
      checkoutFailed = true;
      this.logger.error(`Failed to checkout default branch: ${(error as Error).message}`);
      this.logger.dim('Hint: Stash or discard changes first');
      this.logger.dim('State will be cleaned up, but you may need to manually switch branches');
    }

    // Step 3: Delete the feature branch
    try {
      const branchExists = await this.git.branchExists(state.branch);
      if (branchExists) {
        this.logger.info(`Deleting branch ${state.branch}...`);
        await this.git.deleteBranch(state.branch, {
          force: true,
          remote: branchPushed,
        });
        this.logger.success(`Branch ${state.branch} deleted`);
      }
    } catch (error) {
      this.logger.warn(`Failed to delete branch: ${(error as Error).message}`);
      this.logger.dim(`You may need to delete it manually: git branch -D ${state.branch}`);
    }

    console.log('');

    // Step 4: Clean up issue-specific logs and reviews
    await this.cleanupIssueFiles(state.issue_number);
    this.logger.success('Cleaned up logs and reviews');

    // Step 5: Delete state file
    await this.state.delete();
    this.logger.success('Pipeline state cleared');

    console.log('');

    if (checkoutFailed) {
      this.logger.warn('Rollback partially complete. State cleaned up but checkout failed.');
      this.logger.dim('Please manually switch to master/main branch');
      process.exit(1);
      return; // For testing
    }

    this.logger.success('Rollback complete. All work for this issue has been undone.');
    this.logger.dim("Run 'rig next' to start a new pipeline.");
  }

  /**
   * Cleans up issue-specific log, review, and demo files.
   *
   * @param issueNumber - Issue number to clean up
   */
  private async cleanupIssueFiles(issueNumber: number): Promise<void> {
    const fs = await import('fs/promises');
    const path = await import('path');

    try {
      const projectRoot = this.projectRoot || process.cwd();

      // Clean up log files: .rig-logs/*issue-{number}*
      const logDir = path.join(projectRoot, '.rig-logs');
      try {
        const logFiles = await fs.readdir(logDir);
        // Use regex to match exact issue number (not substring)
        const issuePattern = new RegExp(`issue-${issueNumber}(?:-|\\.|$)`);
        for (const file of logFiles) {
          if (issuePattern.test(file)) {
            await fs.unlink(path.join(logDir, file)).catch(() => {});
          }
        }
      } catch {
        // Ignore if directory doesn't exist
      }

      // Clean up review directory: .rig-reviews/issue-{number}/
      const reviewDir = path.join(projectRoot, '.rig-reviews', `issue-${issueNumber}`);
      await fs.rm(reviewDir, { recursive: true, force: true }).catch(() => {});

      // Clean up demo directory: .rig-demos/issue-{number}/
      const demoDir = path.join(projectRoot, '.rig-demos', `issue-${issueNumber}`);
      await fs.rm(demoDir, { recursive: true, force: true }).catch(() => {});
    } catch (error) {
      // Silently ignore cleanup errors - not critical
    }
  }

}
