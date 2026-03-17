import { BaseCommand } from './base-command.js';
import { Logger } from '../services/logger.service.js';
import { ConfigManager } from '../services/config-manager.service.js';
import { StateManager } from '../services/state-manager.service.js';
import { GitService } from '../services/git.service.js';
import { GitHubService } from '../services/github.service.js';
import { GuardService } from '../services/guard.service.js';
import { createAgent } from '../services/agents/agent-factory.js';
import { PromptBuilderService } from '../services/prompt-builder.service.js';
import { TemplateEngine } from '../services/template-engine.service.js';
import * as path from 'path';

/**
 * ImplementCommand runs Claude Code agent to implement an issue.
 *
 * Uses PromptBuilderService to construct the implementation prompt,
 * then executes Claude Code to implement the changes.
 * Logs output and updates pipeline state.
 */
export class ImplementCommand extends BaseCommand {
  private promptBuilder: PromptBuilderService;

  /**
   * Creates a new ImplementCommand instance.
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
    this.promptBuilder = new PromptBuilderService(this.github, this.git, templateEngine);
  }

  /**
   * Executes the implement command.
   *
   * Checks for active pipeline, assembles prompt, runs Claude agent,
   * and updates state based on outcome.
   *
   * @param options - Command options
   * @param options.issue - Optional issue number to implement (overrides state)
   * @param options.dryRun - If true, show prompt without executing
   */
  async execute(options?: { issue?: string; dryRun?: boolean }): Promise<void> {
    // Check GitHub authentication
    await this.guard.requireGhAuth();

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
        // Create minimal state for ad-hoc implementation
        const issue = await this.github.viewIssue(issueNumber);
        state = {
          issue_number: issueNumber,
          issue_title: issue.title,
          branch: `issue-${issueNumber}`,
          stage: 'implement',
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
    }

    // Check Claude agent is available (skip if dry-run)
    if (!options?.dryRun) {
      const agent = createAgent(this.config.get());
      const auth = await agent.checkAuth();
      if (!auth.authenticated) {
        this.logger.error(auth.error || 'Agent is not available');
        process.exit(1);
        return; // For testing
      }
    }

    this.logger.header(`Implementing Issue #${issueNumber}`);
    console.log('');
    this.logger.info(`Issue: ${state.issue_title}`);
    this.logger.info(`Branch: ${state.branch}`);
    if (options?.dryRun) {
      this.logger.warn('[DRY RUN MODE - No changes will be made]');
    }
    console.log('');

    // Update state to mark implement as in_progress (skip if dry-run)
    if (!options?.dryRun) {
      await this.state.write({
        ...state,
        stage: 'implement',
        stages: {
          ...state.stages,
          implement: 'in_progress',
        },
      });
    }

    // Assemble prompt
    this.logger.step(1, 2, 'Assembling implementation prompt...');
    const prompt = await this.promptBuilder.assemblePrompt(issueNumber);

    // Get issue for component detection
    const issue = await this.github.viewIssue(state.issue_number);
    const labels = issue.labels.map((l: any) => l.name);
    const rigConfig = this.config.get();
    const component = this.promptBuilder.detectComponentFromConfig(labels, rigConfig);
    const allowedTools = this.promptBuilder.buildAllowedTools(component);

    // Get max turns, verbose, and permission mode from config
    const maxTurns = rigConfig.agent.max_turns || 20;
    const verbose = rigConfig.verbose || false;
    const permissionMode = rigConfig.agent.permission_mode || 'default';

    // Prepare log file
    const logFile = path.join(
      this.projectRoot || process.cwd(),
      '.rig-logs',
      `issue-${issueNumber}.log`
    );

    // Handle dry-run mode
    if (options?.dryRun) {
      this.logger.step(2, 2, 'Preview (dry-run)');
      console.log('');
      this.logger.info('Prompt preview:');
      console.log('---');
      console.log(prompt.substring(0, 500) + (prompt.length > 500 ? '...' : ''));
      console.log('---');
      console.log('');
      this.logger.info('Configuration:');
      this.logger.info(`  Max turns: ${maxTurns}`);
      this.logger.info(`  Allowed tools: ${allowedTools}`);
      this.logger.info(`  Verbose: ${verbose}`);
      this.logger.info(`  Permission mode: ${permissionMode}`);
      this.logger.info(`  Log file: ${logFile}`);
      console.log('');
      this.logger.success('Dry-run complete. Use without --dry-run to execute.');
      return;
    }

    // Run Claude agent
    this.logger.step(2, 2, 'Running Claude Code agent...');
    console.log('');

    try {
      // Capture git state before running Claude to detect changes (uncommitted or committed)
      const changesBefore = await this.git.getStatus();
      const commitBefore = await this.git.getCurrentCommit();

      // Create agent and session
      const agent = createAgent(this.config.get());
      const session = await agent.createSession({
        prompt,
        maxIterations: maxTurns,
        allowedTools: allowedTools.split(','),
        logFile,
        verbose,
        providerOptions: { permissionMode },
      });

      // Stream events to console
      for await (const event of session.events) {
        this.handleAgentEvent(event);
      }

      // Verify that changes were made (either uncommitted files or new commits)
      const changesAfter = await this.git.getStatus();
      const commitAfter = await this.git.getCurrentCommit();

      const hasUncommittedChanges = changesBefore !== changesAfter;
      const hasNewCommits = commitBefore !== commitAfter;

      // If neither uncommitted changes nor new commits were detected, mark as failed
      if (!hasUncommittedChanges && !hasNewCommits) {
        // No changes detected - likely a permission error or failure
        await this.state.write({
          ...state,
          stage: 'implement',
          stages: {
            ...state.stages,
            implement: 'failed',
          },
        });

        console.log('');
        this.logger.error('Implementation failed: No file changes detected');
        this.logger.dim('Claude Code did not modify any files or create commits during execution.');
        this.logger.dim('This typically indicates permission errors prevented file modifications.');
        this.logger.dim(`Check log for details: ${logFile}`);
        process.exit(1);
        return; // For testing
      }

      // Mark implementation complete (only if changes detected)
      await this.state.write({
        ...state,
        stage: 'implement',
        stages: {
          ...state.stages,
          implement: 'completed',
        },
      });

      console.log('');
      this.logger.success(`Issue #${issueNumber} implemented`);
      this.logger.info("Run 'rig test' to verify, or continue with next stage.");
    } catch (error) {
      // Mark implementation failed
      await this.state.write({
        ...state,
        stage: 'implement',
        stages: {
          ...state.stages,
          implement: 'failed',
        },
      });

      this.logger.error(`Implementation failed: ${(error as Error).message}`);
      this.logger.dim(`Check log: ${logFile}`);
      process.exit(1);
      return; // For testing
    }
  }

}
