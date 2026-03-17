import { BaseCommand } from './base-command.js';
import { Logger } from '../services/logger.service.js';
import { ConfigManager } from '../services/config-manager.service.js';
import { StateManager } from '../services/state-manager.service.js';
import { GitService } from '../services/git.service.js';
import { GitHubService } from '../services/github.service.js';
import { GuardService } from '../services/guard.service.js';
import { DemoRecorderService } from '../services/demo-recorder.service.js';
import { PromptBuilderService } from '../services/prompt-builder.service.js';
import { TemplateEngine } from '../services/template-engine.service.js';
import { ComponentType } from '../types/issue.types.js';

/**
 * DISABLED: Demo feature disabled for redesign
 *
 * DemoCommand records a demonstration of the implemented feature.
 *
 * Auto-detects component from issue labels in state, or uses --component override.
 * Records frontend demos (Playwright) or backend demos (VHS) based on component type.
 * Stores demo artifacts in .rig-reviews/issue-N/ directory.
 *
 * NOTE: This command is currently disabled and all operations will be skipped.
 */
export class DemoCommand extends BaseCommand {
  private demoRecorder: DemoRecorderService;
  private promptBuilder: PromptBuilderService;

  /**
   * Creates a new DemoCommand instance.
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
    this.demoRecorder = new DemoRecorderService(
      this.logger,
      this.config,
      templateEngine,
      this.projectRoot || process.cwd()
    );
    this.promptBuilder = new PromptBuilderService(this.github, this.git, templateEngine);
  }

  /**
   * Executes the demo command.
   *
   * Checks for active pipeline, detects component, records demo,
   * and updates state based on outcome.
   *
   * @param options - Command options
   * @param options.issue - Optional issue number to demo (overrides state)
   * @param options.component - Optional component to demo (overrides auto-detection)
   */
  async execute(options?: { issue?: string; component?: string }): Promise<void> {
    // Determine issue number
    let issueNumber: number;
    let state: any;

    if (options?.issue) {
      // Use --issue flag
      issueNumber = parseInt(options.issue, 10);
      if (isNaN(issueNumber)) {
        this.logger.error(`Invalid issue number: ${options.issue}`);
        process.exit(1);
        return; // For testing
      }

      // Load or create minimal state for this issue
      const stateExists = await this.state.exists();
      if (stateExists) {
        state = await this.state.read();
      } else {
        // Create minimal state for ad-hoc demo
        const issue = await this.github.viewIssue(issueNumber);
        state = {
          issue_number: issueNumber,
          issue_title: issue.title,
          branch: `issue-${issueNumber}`,
          stage: 'demo',
          stages: {
            pick: 'completed',
            branch: 'pending',
            implement: 'pending',
            test: 'pending',
            demo: 'pending',
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
    }

    // Determine component to demo
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
      // Auto-detect from issue labels
      const issue = await this.github.viewIssue(state.issue_number);
      const labels = issue.labels.map((l: any) => l.name);
      component = this.promptBuilder.detectComponentFromConfig(labels, this.config.get());
    }

    this.logger.header(`Recording Demo for Issue #${issueNumber}`);
    console.log('');
    this.logger.info(`Issue: ${state.issue_title}`);
    this.logger.info(`Component: ${component}`);
    console.log('');

    // Update state to mark demo as in_progress
    await this.state.write({
      ...state,
      stage: 'demo',
      stages: {
        ...state.stages,
        demo: 'in_progress',
      },
    });

    // Record demo
    this.logger.step(1, 1, `Recording ${component} demo...`);
    console.log('');

    try {
      const result = await this.demoRecorder.recordDemo(issueNumber, component);

      if (!result.success) {
        throw new Error('Demo recording failed');
      }

      // Mark demo complete
      await this.state.write({
        ...state,
        stage: 'demo',
        stages: {
          ...state.stages,
          demo: 'completed',
        },
      });

      console.log('');
      if (result.skipped) {
        this.logger.success(`Demo recording completed (skipped for ${component})`);
        this.logger.dim('Some demo components were not available or configured.');
      } else {
        this.logger.success(`Demo recorded for issue #${issueNumber}`);
        if (result.demoPath) {
          this.logger.dim(`  ${result.demoPath}`);
        }
      }
      this.logger.info("Run 'rig pr' to create a pull request, or continue with next stage.");
    } catch (error) {
      // Mark demo failed
      await this.state.write({
        ...state,
        stage: 'demo',
        stages: {
          ...state.stages,
          demo: 'failed',
        },
      });

      this.logger.error(`Demo recording failed: ${(error as Error).message}`);
      this.logger.dim("Fix the issues and run 'rig demo' again.");
      process.exit(1);
      return; // For testing
    }
  }
}
