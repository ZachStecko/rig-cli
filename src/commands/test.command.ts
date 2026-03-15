import { BaseCommand } from './base-command.js';
import { Logger } from '../services/logger.service.js';
import { ConfigManager } from '../services/config-manager.service.js';
import { StateManager } from '../services/state-manager.service.js';
import { GitService } from '../services/git.service.js';
import { GitHubService } from '../services/github.service.js';
import { GuardService } from '../services/guard.service.js';
import { TestRunnerService } from '../services/test-runner.service.js';
import { PromptBuilderService } from '../services/prompt-builder.service.js';
import { TemplateEngine } from '../services/template-engine.service.js';
import { ComponentType } from '../types/issue.types.js';

/**
 * TestCommand runs tests for the current implementation.
 *
 * Auto-detects component from issue labels in state, or uses --component override.
 * Runs lint, build, and tests based on component type.
 * Checks test coverage for new source files.
 */
export class TestCommand extends BaseCommand {
  private testRunner: TestRunnerService;
  private promptBuilder: PromptBuilderService;

  /**
   * Creates a new TestCommand instance.
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
    this.testRunner = new TestRunnerService(
      this.projectRoot || process.cwd(),
      this.git,
      this.config,
      this.logger
    );
    const templateEngine = new TemplateEngine();
    this.promptBuilder = new PromptBuilderService(this.github, this.git, templateEngine);
  }

  /**
   * Executes the test command.
   *
   * Checks for active pipeline, detects component, runs tests,
   * and updates state based on outcome.
   *
   * @param options - Command options
   * @param options.issue - Optional issue number to test (overrides state)
   * @param options.component - Optional component to test (overrides auto-detection)
   */
  async execute(options?: { issue?: string; component?: string }): Promise<void> {
    // Determine issue number
    let issueNumber: number;
    let state: any;
    let issueData: any; // Cache for issue data to avoid redundant API calls

    if (options?.issue) {
      // Use --issue flag
      issueNumber = parseInt(options.issue, 10);
      if (isNaN(issueNumber)) {
        this.logger.error(`Invalid issue number: ${options.issue}`);
        process.exit(1);
        return; // For testing
      }

      // Fetch issue once (will be reused for component detection)
      issueData = await this.github.viewIssue(issueNumber);

      // Load or create minimal state for this issue
      const stateExists = await this.state.exists();
      if (stateExists) {
        state = await this.state.read();
      } else {
        // Create minimal state for ad-hoc testing
        state = {
          issue_number: issueNumber,
          issue_title: issueData.title,
          branch: `issue-${issueNumber}`,
          stage: 'test',
          stages: {
            pick: 'completed',
            branch: 'pending',
            implement: 'pending',
            test: 'pending',
            pr: 'pending',
            review: 'pending',
          },
        };
      }
    } else {
      // Use state from active pipeline
      const stateExists = await this.state.exists();

      if (!stateExists) {
        this.logger.error("No active pipeline. Run 'rig next' to start or use --issue <number>.");
        process.exit(1);
        return; // For testing
      }

      state = await this.state.read();
      issueNumber = state.issue_number;

      // Fetch issue for component detection
      issueData = await this.github.viewIssue(issueNumber);
    }

    // Determine component to test
    let component: ComponentType;

    if (options?.component) {
      // Validate component option
      const validComponents: ComponentType[] = ['backend', 'frontend', 'devnet', 'fullstack'];
      if (!validComponents.includes(options.component as ComponentType)) {
        this.logger.error(`Invalid component: ${options.component}. Must be one of: ${validComponents.join(', ')}`);
        process.exit(1);
        return; // For testing
      }
      component = options.component as ComponentType;
    } else {
      // Auto-detect from issue labels using cached issue data
      const labels = issueData.labels.map((l: any) => l.name);
      component = this.promptBuilder.detectComponent(labels);
    }

    this.logger.header(`Testing Issue #${issueNumber}`);
    console.log('');
    this.logger.info(`Issue: ${state.issue_title}`);
    this.logger.info(`Component: ${component}`);
    console.log('');

    // Update state to mark test as in_progress
    await this.state.write({
      ...state,
      stage: 'test',
      stages: {
        ...state.stages,
        test: 'in_progress',
      },
    });

    // Run tests
    this.logger.step(1, 2, `Running ${component} tests...`);
    console.log('');

    try {
      const result = await this.testRunner.runAllTests(component);

      // Display output if any
      if (result.output) {
        console.log(result.output);
        console.log('');
      }

      if (!result.success) {
        throw new Error('Tests failed');
      }

      // List new test files
      this.logger.step(2, 2, 'Checking new test files...');
      const newTestFiles = await this.testRunner.listNewTestFiles();

      if (newTestFiles.length > 0) {
        this.logger.success(`New test files (${newTestFiles.length}):`);
        newTestFiles.forEach(file => {
          this.logger.dim(`  ${file}`);
        });
      } else {
        this.logger.info('No new test files added');
      }

      // Mark test complete
      await this.state.write({
        ...state,
        stage: 'test',
        stages: {
          ...state.stages,
          test: 'completed',
        },
      });

      console.log('');
      this.logger.success(`Tests passed for issue #${issueNumber}`);
      this.logger.info("Run 'rig demo' to record a demo, or continue with next stage.");
    } catch (error) {
      // Mark test failed
      await this.state.write({
        ...state,
        stage: 'test',
        stages: {
          ...state.stages,
          test: 'failed',
        },
      });

      this.logger.error(`Tests failed: ${(error as Error).message}`);
      this.logger.dim("Fix the issues and run 'rig test' again.");
      process.exit(1);
      return; // For testing
    }
  }
}
