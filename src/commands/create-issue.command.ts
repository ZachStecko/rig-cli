import { BaseCommand } from './base-command.js';
import { Logger } from '../services/logger.service.js';
import { ConfigManager } from '../services/config-manager.service.js';
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
    git: GitService,
    github: GitHubService,
    guard: GuardService,
    projectRoot?: string
  ) {
    super(logger, config, git, github, guard, projectRoot);
    this.llm = new LLMService(undefined, this.config.get(), this.projectRoot);
  }

  /**
   * Executes the create issue command.
   *
   * @param options - Command options
   * @param options.file - Read the description from this file instead of prompting
   * @param options.yes - Skip the confirmation prompt (for non-interactive use)
   * @throws Error if preconditions fail or issue creation fails
   */
  async execute(options?: { file?: string; yes?: boolean }): Promise<void> {
    const rigConfig = this.config.get();
    const verbose = rigConfig.verbose || false;

    // Check preconditions
    await this.guard.requireGhAuth();

    this.logger.header('Create GitHub Issue');
    console.log('');

    this.logger.config('Agent provider', rigConfig.agent.provider || 'groq');
    this.logger.config('Verbose', verbose);
    const defaultLabels = rigConfig.defaultLabels || [];

    // Validate labels against defined constants
    if (defaultLabels.length > 0) {
      const invalidLabels = defaultLabels.filter(label => !isValidLabel(label));
      if (invalidLabels.length > 0) {
        this.logger.error(`Invalid labels in config: ${invalidLabels.join(', ')}`);
        this.logger.info('Valid labels are defined in src/types/labels.types.ts');
        this.logger.info(`Examples: ${getAllValidLabels().slice(0, 10).join(', ')}, ...`);
        process.exit(1);
        return; // For testing
      }
      this.logger.config('Default labels', defaultLabels.join(', '));
    }

    // Check LLM availability before asking the user to type anything,
    // so a missing CLI or API key fails fast instead of after input.
    const llmAvailable = await this.llm.isAvailable();
    this.logger.config('Agent available', llmAvailable);
    if (!llmAvailable) {
      this.logger.error('Agent is not available. Check your .rig.yml provider setting and authentication.');
      process.exit(1);
      return; // For testing
    }

    // Get raw description from the file or the user
    const rawDescription = await this.readMultilineInput(
      options?.file,
      'Describe the issue in your own words (multiline input):'
    );

    if (!rawDescription.trim()) {
      this.logger.warn('No description provided. Aborting.');
      return;
    }

    this.logger.config('Description length', `${rawDescription.length} chars`);

    // Structure the issue using LLM
    let structured;
    try {
      this.logger.command(`${this.llm.providerName} chat/completions`);
      const startTime = Date.now();
      structured = await this.logger.spinner(
        this.llm.structureIssue(rawDescription),
        `Structuring your issue with ${this.llm.providerName}...`
      );
      this.logger.timing('Issue structuring', Date.now() - startTime);
    } catch (error) {
      this.logger.error(`Failed to structure issue: ${error instanceof Error ? error.message : 'Unknown error'}`);
      process.exit(1);
      return; // For testing
    }

    // Display preview
    this.displayPreview(structured.title, structured.body);

    // Confirm creation
    const confirmed = options?.yes || (await this.confirm('\nCreate this issue? (y/n): '));
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
      process.exit(1);
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
