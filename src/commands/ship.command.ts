import { BaseCommand } from './base-command.js';
import { NextCommand } from './next.command.js';
import { ImplementCommand } from './implement.command.js';
import { TestCommand } from './test.command.js';
// import { DemoCommand } from './demo.command.js'; // DISABLED: Demo feature disabled for redesign
import { PrCommand } from './pr.command.js';
import { ReviewCommand } from './review.command.js';
import { Logger } from '../services/logger.service.js';
import { ConfigManager } from '../services/config-manager.service.js';
import { StateManager } from '../services/state-manager.service.js';
import { GitService } from '../services/git.service.js';
import { GitHubService } from '../services/github.service.js';
import { GuardService } from '../services/guard.service.js';
import { createAgent } from '../services/agents/agent-factory.js';
import { PromptBuilderService } from '../services/prompt-builder.service.js';
import { TemplateEngine } from '../services/template-engine.service.js';
import { StageName } from '../types/state.types.js';
import * as path from 'path';

/**
 * Options for the ship command.
 */
export interface ShipOptions {
  /** Start with a specific issue number */
  issue?: string;
  /** Filter by phase (e.g., "Phase 1: MVP") */
  phase?: string;
  /** Filter by component (backend, frontend, fullstack, devnet) */
  component?: string;
}

/**
 * ShipCommand orchestrates the full issue-to-PR pipeline.
 *
 * Runs the complete pipeline from issue selection through code review,
 * with resume capability and test retry logic.
 *
 * Pipeline stages:
 * 1. pick - Select next issue from queue
 * 2. branch - Create git branch
 * 3. implement - Run implementation agent
 * 4. test - Run tests (with retry loop, max 3 attempts)
 * 5. pr - Create pull request
 * 6. review - Run code review agent
 */
export class ShipCommand extends BaseCommand {
  private nextCommand: NextCommand;
  private implementCommand: ImplementCommand;
  private testCommand: TestCommand;
  // private demoCommand: DemoCommand; // DISABLED: Demo feature disabled for redesign
  private prCommand: PrCommand;
  private reviewCommand: ReviewCommand;
  private promptBuilder: PromptBuilderService;

  /**
   * Maximum test retry attempts with fix agent.
   */
  private readonly MAX_TEST_RETRIES = 3;

  /**
   * Creates a new ShipCommand instance.
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

    // Initialize all sub-commands
    this.nextCommand = new NextCommand(logger, config, state, git, github, guard, projectRoot);
    this.implementCommand = new ImplementCommand(logger, config, state, git, github, guard, projectRoot);
    this.testCommand = new TestCommand(logger, config, state, git, github, guard, projectRoot);
    // this.demoCommand = new DemoCommand(logger, config, state, git, github, guard, projectRoot); // DISABLED: Demo feature disabled for redesign
    this.prCommand = new PrCommand(logger, config, state, git, github, guard, projectRoot);
    this.reviewCommand = new ReviewCommand(logger, config, state, git, github, guard, projectRoot);

    // Initialize fix agent services
    const templateEngine = new TemplateEngine();
    this.promptBuilder = new PromptBuilderService(this.github, this.git, templateEngine);
  }

  /**
   * Executes the ship command.
   *
   * Orchestrates the full pipeline, resuming from the current stage if state exists,
   * or starting fresh with issue selection.
   *
   * @param options - Ship options (issue, phase, component filters)
   */
  async execute(options: ShipOptions = {}): Promise<void> {
    // Check GitHub authentication
    await this.guard.requireGhAuth();

    this.logger.header('Ship: Full Issue-to-PR Pipeline');
    console.log('');

    // Check for existing pipeline
    const stateExists = await this.state.exists();

    if (stateExists) {
      // Resume existing pipeline
      const currentState = await this.state.read();

      // Check for stale state (issue may have been closed/merged)
      const isStale = await this.isStateStale(currentState.issue_number);
      if (isStale) {
        this.logger.error(`Issue #${currentState.issue_number} is no longer OPEN. Pipeline aborted.`);
        this.logger.info(`Run 'rig reset' to clear state and start fresh.`);
        process.exit(1);
        return; // For testing
      }

      this.logger.info(`Resuming pipeline for issue #${currentState.issue_number}: ${currentState.issue_title}`);
      this.logger.dim(`Current stage: ${currentState.stage}`);
      console.log('');

      await this.runPipeline(currentState.stage);
    } else {
      // Start fresh pipeline
      if (options.issue) {
        // Start with specific issue
        const issueNumber = parseInt(options.issue, 10);
        if (isNaN(issueNumber)) {
          this.logger.error(`Invalid issue number: ${options.issue}`);
          process.exit(1);
          return; // For testing
        }

        this.logger.info(`Starting pipeline with issue #${issueNumber}...`);
        console.log('');

        // Initialize state with specific issue
        await this.nextCommand.execute({ issue: options.issue, phase: options.phase, component: options.component });
      } else {
        // Pick next issue from queue
        this.logger.info('Picking next issue from queue...');
        console.log('');

        await this.nextCommand.execute({ phase: options.phase, component: options.component });
      }

      // Start pipeline from beginning
      await this.runPipeline('pick');
    }

    // Close the issue explicitly (Closes #N in PR body only works for default branch)
    const finalState = await this.state.read();
    await this.github.closeIssue(finalState.issue_number);

    console.log('');
    this.logger.success('Pipeline complete!');
    this.logger.info('Issue has been implemented, tested, and submitted for review.');
  }

  /**
   * Runs the pipeline from the specified stage onwards.
   *
   * Executes each stage in order, with special handling for the test stage
   * (retry loop with fix agent).
   *
   * @param startStage - Stage to start from
   */
  private async runPipeline(startStage: StageName): Promise<void> {
    const stages: StageName[] = ['pick', 'branch', 'implement', 'test', 'pr', 'review']; // 'demo' removed - feature disabled for redesign
    const startIndex = stages.indexOf(startStage);

    if (startIndex === -1) {
      throw new Error(`Unknown pipeline stage: ${startStage}`);
    }

    // Get current state to check which stages are already completed
    const currentState = await this.state.read();

    // Execute stages from startStage onwards
    for (let i = startIndex; i < stages.length; i++) {
      const stage = stages[i];

      // Skip 'pick' stage - it's always done by nextCommand before we get here
      if (stage === 'pick') {
        continue;
      }

      // Skip 'branch' stage if already completed (nextCommand creates the branch)
      if (stage === 'branch' && currentState.stages.branch === 'completed') {
        this.logger.dim(`Skipping branch stage (already completed)`);
        continue;
      }

      await this.executeStage(stage);
    }
  }

  /**
   * Executes a single pipeline stage.
   *
   * @param stage - Stage to execute
   */
  private async executeStage(stage: StageName): Promise<void> {
    console.log('');
    this.logger.info(`Stage: ${stage}`);
    console.log('');

    switch (stage) {
      case 'branch':
        await this.executeBranchStage();
        break;

      case 'implement':
        await this.implementCommand.execute();
        break;

      case 'test':
        await this.executeTestStageWithRetry();
        break;

      // case 'demo': // DISABLED: Demo feature disabled for redesign
      //   await this.demoCommand.execute({});
      //   break;

      case 'pr':
        await this.prCommand.execute();
        break;

      case 'review':
        await this.reviewCommand.execute();
        break;

      default:
        throw new Error(`Unknown stage: ${stage}`);
    }
  }

  /**
   * Executes the branch stage.
   *
   * Creates and checks out the feature branch from state.
   */
  private async executeBranchStage(): Promise<void> {
    const state = await this.state.read();

    this.logger.info(`Creating branch: ${state.branch}`);

    try {
      await this.git.createBranch(state.branch);
      this.logger.success(`Created and checked out branch: ${state.branch}`);
    } catch (error) {
      this.logger.error(`Failed to create branch: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Executes the test stage with retry logic.
   *
   * Runs tests up to MAX_TEST_RETRIES times. If tests fail, runs fix agent
   * to address failures, then retries.
   */
  private async executeTestStageWithRetry(): Promise<void> {
    for (let attempt = 1; attempt <= this.MAX_TEST_RETRIES; attempt++) {
      try {
        // Run tests
        await this.testCommand.execute({});

        // Tests passed!
        return;
      } catch (error) {
        // Tests failed
        if (attempt >= this.MAX_TEST_RETRIES) {
          // Out of retries
          this.logger.error(`Tests failed after ${this.MAX_TEST_RETRIES} attempts. Pipeline aborted.`);
          this.logger.info(`Run 'rig test' to retry, or 'rig reset' to abandon this issue.`);
          throw error;
        }

        // Retry with fix agent
        this.logger.warn(`Tests failed on attempt ${attempt}/${this.MAX_TEST_RETRIES}.`);
        this.logger.info('Running fix agent to address test failures...');
        console.log('');

        // Extract error message from error
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Generate fix prompt
        const fixPrompt = await this.promptBuilder.assembleFixPrompt(errorMessage);

        // Run fix agent
        const logFile = path.join(this.projectRoot || process.cwd(), '.rig-logs', `fix-attempt-${attempt}.log`);

        try {
          const config = this.config.get();
          const fixAgent = createAgent(this.config.get());
          const fixSession = await fixAgent.createSession({
            prompt: fixPrompt,
            maxIterations: config.agent.max_turns,
            logFile,
          });

          // Consume all events (don't display, just run)
          for await (const _event of fixSession.events) {
            // Fix agent runs silently
          }

          this.logger.success('Fix agent completed. Retrying tests...');
          console.log('');
        } catch (fixError) {
          this.logger.warn('Fix agent encountered an error. Retrying tests anyway...');
          console.log('');
        }
      }
    }
  }

  /**
   * Checks if the pipeline state is stale.
   *
   * A state is stale if the issue is no longer OPEN (may have been closed or merged).
   *
   * @param issueNumber - Issue number to check
   * @returns true if state is stale (issue not open)
   */
  private async isStateStale(issueNumber: number): Promise<boolean> {
    try {
      const issue = await this.github.viewIssue(issueNumber);

      // Check if issue is still open
      return issue.state !== 'OPEN';
    } catch (error) {
      // Issue doesn't exist or can't be fetched
      return true;
    }
  }
}
