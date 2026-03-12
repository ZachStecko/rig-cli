import { BaseCommand } from './base-command.js';
import { IssueQueueService } from '../services/issue-queue.service.js';
import { Logger } from '../services/logger.service.js';
import { ConfigManager } from '../services/config-manager.service.js';
import { StateManager } from '../services/state-manager.service.js';
import { GitService } from '../services/git.service.js';
import { GitHubService } from '../services/github.service.js';
import { GuardService } from '../services/guard.service.js';
import { slugify } from '../utils/slugify.js';
import { INITIAL_STAGES } from '../types/state.types.js';

/**
 * Options for the next command.
 */
export interface NextOptions {
  /** Filter by phase (e.g., "Phase 1: MVP") */
  phase?: string;
  /** Filter by component (backend, frontend, fullstack, devnet) */
  component?: string;
}

/**
 * NextCommand picks the next issue from the queue and initializes the pipeline.
 *
 * Selects the first eligible issue without an open PR, creates initial pipeline
 * state, and prepares for implementation.
 */
export class NextCommand extends BaseCommand {
  private issueQueue: IssueQueueService;

  /**
   * Creates a new NextCommand instance.
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
   * Executes the next command.
   *
   * Picks the next issue from queue, creates pipeline state with generated branch name.
   *
   * @param options - Next options (phase, component filters)
   */
  async execute(options: NextOptions = {}): Promise<void> {
    // Check GitHub authentication
    await this.guard.requireGhAuth();

    this.logger.header('Picking Next Issue');
    console.log('');

    // Get next issue without an open PR
    const issue = await this.issueQueue.next(options);

    if (!issue) {
      this.logger.warn('No eligible issues found in the queue.');
      process.exit(1);
      return; // For testing - process.exit may be mocked
    }

    // Display issue details
    const labels = issue.labels.join(', ');

    this.logger.success(`Selected issue #${issue.number}: ${issue.title}`);
    if (labels) {
      this.logger.dim(`  Labels: ${labels}`);
    }

    // Generate branch name
    const slug = slugify(issue.title);
    const branchName = `issue-${issue.number}-${slug}`;

    // Create initial pipeline state
    await this.state.ensureDirs();

    const initialState = {
      issue_number: issue.number,
      issue_title: issue.title,
      branch: branchName,
      stage: 'pick' as const,
      stages: {
        ...INITIAL_STAGES,
        pick: 'completed' as const,
      },
    };

    await this.state.write(initialState);

    this.logger.info(`Branch name: ${branchName}`);

    // Create and checkout the feature branch
    try {
      await this.git.createBranch(branchName);
      this.logger.success(`Created and checked out branch: ${branchName}`);

      // Update state to mark branch stage as completed
      await this.state.write({
        ...initialState,
        stage: 'branch' as const,
        stages: {
          ...initialState.stages,
          branch: 'completed' as const,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to create branch: ${(error as Error).message}`);
      // Clean up state on failure
      await this.state.delete();
      process.exit(1);
      return; // For testing
    }

    this.logger.info("State saved. Ready to begin implementation.");
  }
}
