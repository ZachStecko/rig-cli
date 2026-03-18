import { BaseCommand } from './base-command.js';
import { Logger } from '../services/logger.service.js';
import { ConfigManager } from '../services/config-manager.service.js';
import { StateManager } from '../services/state-manager.service.js';
import { GitService } from '../services/git.service.js';
import { GitHubService } from '../services/github.service.js';
import { GuardService } from '../services/guard.service.js';
import { LLMService } from '../services/llm.service.js';
import { isValidLabel, getAllValidLabels } from '../types/labels.types.js';

/**
 * CreateIssueCommand handles interactive issue creation with LLM-powered structuring.
 *
 * Workflow:
 * 1. Prompt user for raw issue description (multiline)
 * 2. Use LLM to structure description into proper GitHub issue format
 * 3. Display structured issue preview
 * 4. Confirm and create issue on GitHub
 */
export class CreateIssueCommand extends BaseCommand {
  private llm: LLMService;

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
    this.llm = new LLMService(undefined, this.config.get());
  }

  /**
   * Executes the create issue command.
   *
   * @throws Error if preconditions fail or issue creation fails
   */
  async execute(): Promise<void> {
    const rigConfig = this.config.get();
    const verbose = rigConfig.verbose || false;

    // Check preconditions
    await this.guard.requireGhAuth();

    this.logger.header('Create GitHub Issue');
    console.log('');

    this.logger.config('Agent provider', rigConfig.agent.provider || 'binary');
    this.logger.config('Verbose', verbose);
    const defaultLabels = rigConfig.defaultLabels || [];

    // Validate labels against defined constants
    if (defaultLabels.length > 0) {
      const invalidLabels = defaultLabels.filter(label => !isValidLabel(label));
      if (invalidLabels.length > 0) {
        this.logger.error(`Invalid labels in config: ${invalidLabels.join(', ')}`);
        this.logger.info('Valid labels are defined in src/types/labels.types.ts');
        this.logger.info(`Examples: ${getAllValidLabels().slice(0, 10).join(', ')}, ...`);
        return;
      }
      this.logger.config('Default labels', defaultLabels.join(', '));
    }

    // Get raw description from user
    this.logger.info('Describe the issue in your own words (multiline input):');
    this.logger.dim('  Press Ctrl+D when done');
    console.log('');
    const rawDescription = await this.promptMultiline();

    if (!rawDescription.trim()) {
      this.logger.warn('No description provided. Aborting.');
      return;
    }

    this.logger.config('Description length', `${rawDescription.length} chars`);

    // Check if LLM service is available
    const llmAvailable = await this.llm.isAvailable();
    this.logger.config('Agent available', llmAvailable);
    if (!llmAvailable) {
      this.logger.error('Agent is not available. Check your .rig.yml provider setting and authentication.');
      return;
    }

    // Structure the issue using LLM
    let structured;
    try {
      this.logger.command('claude -p <prompt> --output-format json');
      const startTime = Date.now();
      structured = await this.logger.spinner(
        this.llm.structureIssue(rawDescription),
        'Structuring your issue with Claude...'
      );
      this.logger.timing('Issue structuring', Date.now() - startTime);
    } catch (error) {
      this.logger.error(`Failed to structure issue: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return;
    }

    // Display preview
    this.displayPreview(structured.title, structured.body);

    // Confirm creation
    const confirmed = await this.confirm('\nCreate this issue? (y/n): ');
    if (!confirmed) {
      this.logger.warn('Issue creation cancelled.');
      return;
    }

    // Create the issue
    try {
      // Merge LLM-suggested labels with default labels from config
      const llmLabels = structured.labels || [];
      const allLabels = [...new Set([...defaultLabels, ...llmLabels])];
      if (allLabels.length > 0) {
        this.logger.info(`Labels: ${allLabels.join(', ')}`);
      }

      // Ensure all labels exist in the repo before creating the issue
      if (allLabels.length > 0) {
        const createdLabels = await this.github.ensureLabels(allLabels);
        if (createdLabels.length > 0) {
          this.logger.info(`Created missing labels: ${createdLabels.join(', ')}`);
        }
      }

      this.logger.command('gh issue create');
      const issueNumber = await this.github.createIssue({
        title: structured.title,
        body: structured.body,
        labels: allLabels.length > 0 ? allLabels : undefined,
      });

      console.log('');
      this.logger.success(`Issue #${issueNumber} created successfully!`);

      // Get repository name and display URL
      const repoName = await this.github.repoName();
      console.log(`  https://github.com/${repoName}/issues/${issueNumber}`);
    } catch (error) {
      this.logger.error(`Failed to create issue: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Displays a preview of the structured issue.
   *
   * @param title - Issue title
   * @param body - Issue body
   */
  private displayPreview(title: string, body: string): void {
    console.log('');
    this.logger.header('Preview');
    console.log('');
    this.logger.info('Title:');
    console.log(`  ${title}`);

    // Warn if title is very long
    if (title.length > 200) {
      this.logger.warn('  Title is quite long (' + title.length + ' characters)');
    }

    console.log('');
    this.logger.info('Body:');
    // Indent body lines for display
    body.split('\n').forEach(line => {
      console.log(`  ${line}`);
    });

    // Info about body length if it's very large
    if (body.length > 5000) {
      console.log('');
      this.logger.dim(`  (${body.length} characters)`);
    }
  }
}
