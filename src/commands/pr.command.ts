import { BaseCommand } from './base-command.js';
import { Logger } from '../services/logger.service.js';
import { ConfigManager } from '../services/config-manager.service.js';
import { StateManager } from '../services/state-manager.service.js';
import { GitService } from '../services/git.service.js';
import { GitHubService } from '../services/github.service.js';
import { GuardService } from '../services/guard.service.js';
import { PrTemplateService } from '../services/pr-template.service.js';
import { PromptBuilderService } from '../services/prompt-builder.service.js';
import { TemplateEngine } from '../services/template-engine.service.js';
import { TestRunnerService } from '../services/test-runner.service.js';

/**
 * PrCommand creates or updates a pull request for the implemented issue.
 *
 * Auto-detects component from issue labels, generates PR body from template,
 * and handles both create and update flows. Pushes commits to remote if needed.
 */
export class PrCommand extends BaseCommand {
  private prTemplate: PrTemplateService;
  private promptBuilder: PromptBuilderService;

  /**
   * Creates a new PrCommand instance.
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
    const templateEngine = new TemplateEngine();
    const testRunner = new TestRunnerService(this.projectRoot || process.cwd(), this.git);
    this.prTemplate = new PrTemplateService(
      this.github,
      this.git,
      templateEngine,
      testRunner,
      this.projectRoot || process.cwd()
    );
    this.promptBuilder = new PromptBuilderService(this.github, this.git, templateEngine);
  }

  /**
   * Executes the pr command.
   *
   * Checks for active pipeline, pushes commits, creates or updates PR,
   * and updates state based on outcome.
   */
  async execute(): Promise<void> {
    // Check GitHub authentication
    await this.guard.requireGhAuth();

    // Check for active pipeline
    const stateExists = await this.state.exists();

    if (!stateExists) {
      this.logger.error("No active pipeline. Run 'rig next' to start.");
      process.exit(1);
      return; // For testing
    }

    // Load current state
    const state = await this.state.read();
    const issueNumber = state.issue_number;

    // Get issue for component detection
    const issue = await this.github.viewIssue(issueNumber);
    const labels = issue.labels.map((l: any) => l.name);
    const component = this.promptBuilder.detectComponent(labels);

    // Get current branch
    const currentBranch = await this.git.currentBranch();

    this.logger.header(`Creating Pull Request for Issue #${issueNumber}`);
    console.log('');
    this.logger.info(`Issue: ${state.issue_title}`);
    this.logger.info(`Branch: ${currentBranch}`);
    this.logger.info(`Component: ${component}`);
    console.log('');

    // Update state to mark pr as in_progress
    await this.state.write({
      ...state,
      stage: 'pr',
      stages: {
        ...state.stages,
        pr: 'in_progress',
      },
    });

    try {
      // Step 1: Push commits to remote
      this.logger.step(1, 3, 'Pushing commits to remote...');
      await this.git.push();
      console.log('');

      // Step 2: Generate PR body
      this.logger.step(2, 3, 'Generating PR body from template...');
      const prBody = await this.prTemplate.generatePrBody(issueNumber, component);
      console.log('');

      // Step 3: Check if PR already exists for this branch
      this.logger.step(3, 3, 'Creating or updating pull request...');
      const existingPrs = await this.github.prListByHead(currentBranch);

      let prUrl: string;

      if (existingPrs.length > 0) {
        // Update existing PR
        const prNumber = existingPrs[0].number;
        this.logger.info(`Updating existing PR #${prNumber}...`);

        const prTitle = `${issue.title}`;
        await this.github.editPr(prNumber, {
          title: prTitle,
          body: prBody,
        });

        // Construct PR URL (gh pr edit doesn't return URL)
        const repoName = await this.github.repoName();
        prUrl = `https://github.com/${repoName}/pull/${prNumber}`;
      } else {
        // Create new PR
        this.logger.info('Creating new pull request...');

        const prTitle = `${issue.title}`;
        prUrl = await this.github.createPr({
          title: prTitle,
          body: prBody,
        });
      }

      // Mark pr complete
      await this.state.write({
        ...state,
        stage: 'pr',
        stages: {
          ...state.stages,
          pr: 'completed',
        },
      });

      console.log('');
      this.logger.success('Pull request created/updated successfully');
      this.logger.info(`URL: ${prUrl}`);
      this.logger.dim("Run 'rig review' to perform code review, or merge the PR manually.");
    } catch (error) {
      // Mark pr failed
      await this.state.write({
        ...state,
        stage: 'pr',
        stages: {
          ...state.stages,
          pr: 'failed',
        },
      });

      this.logger.error(`PR creation failed: ${(error as Error).message}`);
      this.logger.dim("Fix the issues and run 'rig pr' again.");
      process.exit(1);
      return; // For testing
    }
  }
}
