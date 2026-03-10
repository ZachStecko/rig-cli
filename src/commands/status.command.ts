import { BaseCommand } from './base-command.js';
import { STAGE_ORDER, StageStatus } from '../types/state.types.js';
import chalk from 'chalk';

/**
 * StatusCommand displays the current pipeline state.
 *
 * Shows issue info, branch, current stage, progress through all stages,
 * and git status (commits ahead, files changed).
 */
export class StatusCommand extends BaseCommand {
  /**
   * Executes the status command.
   *
   * Displays pipeline state or message if no active pipeline.
   */
  async execute(): Promise<void> {
    this.logger.header('Pipeline Status');
    console.log('');

    // Check if state exists
    const stateExists = await this.state.exists();
    if (!stateExists) {
      this.logger.dim("No active pipeline. Run 'rig next' or 'rig ship' to start.");
      return;
    }

    // Load state
    const state = await this.state.read();

    // Display issue and branch info
    console.log(`  ${chalk.bold('Issue:')}   #${state.issue_number} — ${state.issue_title}`);
    console.log(`  ${chalk.bold('Branch:')}  ${state.branch}`);
    console.log(`  ${chalk.bold('Stage:')}   ${state.stage}`);
    console.log('');

    // Display stage progress
    for (const stage of STAGE_ORDER) {
      const status = state.stages[stage];
      const icon = this.getStageIcon(status);
      const formattedStage = stage.padEnd(12);
      console.log(`  ${icon}  ${formattedStage} ${status}`);
    }

    console.log('');

    // Display git status
    await this.displayGitStatus();
  }

  /**
   * Gets the icon for a stage status.
   *
   * @param status - Stage status
   * @returns Colored icon string
   * @private
   */
  private getStageIcon(status: StageStatus): string {
    switch (status) {
      case 'completed':
        return chalk.green('✓');
      case 'in_progress':
        return chalk.yellow('◉');
      case 'failed':
        return chalk.red('✗');
      case 'pending':
      default:
        return chalk.dim('○');
    }
  }

  /**
   * Displays git status information.
   *
   * Shows current branch, commits ahead of master/main, and files changed.
   *
   * @private
   */
  private async displayGitStatus(): Promise<void> {
    try {
      const currentBranch = await this.git.currentBranch();
      const commitCount = await this.git.commitCountVsMaster();
      const changedFiles = await this.git.changedFilesCountVsMaster();

      console.log(`  ${chalk.bold('Git:')}`);
      console.log(`    Current branch: ${currentBranch}`);
      console.log(`    Commits ahead of master: ${commitCount}`);
      console.log(`    Files changed: ${changedFiles}`);
    } catch (error) {
      // If git operations fail, just skip git status section
      this.logger.dim('  Git status unavailable');
    }
  }
}
