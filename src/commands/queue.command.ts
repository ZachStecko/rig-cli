import { BaseCommand } from './base-command.js';
import { IssueQueueService } from '../services/issue-queue.service.js';
import { Logger } from '../services/logger.service.js';
import { ConfigManager } from '../services/config-manager.service.js';
import { StateManager } from '../services/state-manager.service.js';
import { GitService } from '../services/git.service.js';
import { GitHubService } from '../services/github.service.js';
import { GuardService } from '../services/guard.service.js';
import chalk from 'chalk';

/**
 * Options for the queue command.
 */
export interface QueueOptions {
  /** Filter by phase (e.g., "Phase 1: MVP") */
  phase?: string;
  /** Filter by component (backend, frontend, fullstack, devnet) */
  component?: string;
}

/**
 * QueueCommand displays the prioritized issue backlog.
 *
 * Shows issues in a formatted table with issue number, title, and labels.
 * Supports filtering by phase and component.
 */
export class QueueCommand extends BaseCommand {
  private issueQueue: IssueQueueService;

  /** Column widths for table formatting */
  private static readonly COLUMN_WIDTHS = {
    NUMBER: 6,
    TITLE: 60,
    LABELS: 30,
  } as const;

  /** Truncation lengths (account for padding and ellipsis) */
  private static readonly TRUNCATE = {
    TITLE: 58,
    LABELS: 25, // 25 + 3 for '...' = 28
  } as const;

  /**
   * Creates a new QueueCommand instance.
   *
   * Initializes IssueQueueService with the GitHub service.
   */
  constructor(
    logger: Logger,
    config: ConfigManager,
    state: StateManager,
    git: GitService,
    github: GitHubService,
    guard: GuardService,
    projectRoot?: string
  ) {
    super(logger, config, state, git, github, guard, projectRoot);
    this.issueQueue = new IssueQueueService(this.github);
  }

  /**
   * Executes the queue command.
   *
   * Fetches issues with optional filters, displays them in a formatted table.
   *
   * @param options - Queue options (phase, component filters)
   */
  async execute(options: QueueOptions = {}): Promise<void> {
    // Check GitHub authentication
    await this.guard.requireGhAuth();

    this.logger.header('Issue Queue');
    console.log('');

    // Fetch issues with filters
    const issues = await this.issueQueue.fetch(options);

    if (issues.length === 0) {
      this.logger.warn('No eligible issues found.');
      return;
    }

    // Display table header
    const { NUMBER, TITLE, LABELS } = QueueCommand.COLUMN_WIDTHS;

    console.log(`  ${'#'.padEnd(NUMBER)} ${'Title'.padEnd(TITLE)} ${'Labels'}`);
    console.log(`  ${'─'.repeat(NUMBER - 1)} ${'─'.repeat(TITLE - 1)} ${'─'.repeat(LABELS)}`);

    // Display each issue
    for (let i = 0; i < issues.length; i++) {
      const issue = issues[i];
      const marker = i === 0 ? '→' : ' ';
      const num = `#${issue.number}`;
      const title = issue.title.slice(0, QueueCommand.TRUNCATE.TITLE);
      let labels = issue.labels.join(', ');
      if (labels.length > 28) {
        labels = labels.slice(0, QueueCommand.TRUNCATE.LABELS) + '...';
      }

      console.log(`  ${marker}${num.padEnd(NUMBER - 1)} ${title.padEnd(TITLE)} ${labels}`);
    }

    console.log('');
    console.log(`  ${chalk.dim(`${issues.length} issues in queue`)}`);
  }
}
