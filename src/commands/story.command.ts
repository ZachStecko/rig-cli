import { BaseCommand } from './base-command.js';
import { Logger } from '../services/logger.service.js';
import { ConfigManager } from '../services/config-manager.service.js';
import { StateManager } from '../services/state-manager.service.js';
import { GitService } from '../services/git.service.js';
import { GitHubService } from '../services/github.service.js';
import { GuardService } from '../services/guard.service.js';
import { LLMService } from '../services/llm.service.js';
import { TYPE_LABELS, SPECIAL_LABELS } from '../types/labels.types.js';

/**
 * StoryCommand decomposes a planning spec / PRD into a parent story issue
 * and a set of atomic child issues on GitHub.
 *
 * Workflow:
 * 1. Prompt user for spec content via multiline input
 * 2. Use LLM to structure parent story issue
 * 3. Display preview, get user confirmation
 * 4. Create parent issue with 'story' + 'rig-created' labels
 * 5. Use LLM to decompose spec into atomic child issues
 * 6. Display child issue count/titles, get confirmation
 * 7. Create each child issue with 'rig-created' label
 * 8. Log summary with parent + child URLs
 */
export class StoryCommand extends BaseCommand {
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

  async execute(): Promise<void> {
    const rigConfig = this.config.get();
    const defaultLabels = rigConfig.defaultLabels || [];

    await this.guard.requireGhAuth();

    this.logger.header('Decompose Planning Spec');
    console.log('');

    // Prompt for spec content
    this.logger.info('Paste your planning spec / PRD (multiline input):');
    this.logger.dim('  Press Ctrl+D when done');
    console.log('');
    const specContent = await this.promptMultiline();

    if (!specContent.trim()) {
      this.logger.warn('No spec content provided. Aborting.');
      return;
    }

    this.logger.config('Spec length', `${specContent.length} chars`);

    // Check LLM availability
    const llmAvailable = await this.llm.isAvailable();
    if (!llmAvailable) {
      this.logger.error('Agent is not available. Check your .rig.yml provider setting and authentication.');
      return;
    }

    // Structure parent story
    let parentIssue;
    try {
      this.logger.command('claude -p <prompt> --output-format json');
      const startTime = Date.now();
      parentIssue = await this.logger.spinner(
        this.llm.structureIssue(specContent),
        'Structuring parent story with Claude...'
      );
      this.logger.timing('Story structuring', Date.now() - startTime);
    } catch (error) {
      this.logger.error(`Failed to structure story: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return;
    }

    // Preview parent
    this.displayPreview('Parent Story', parentIssue.title, parentIssue.body);

    const parentConfirmed = await this.confirm('\nCreate parent story? (y/n): ');
    if (!parentConfirmed) {
      this.logger.warn('Story creation cancelled.');
      return;
    }

    // Create parent issue
    const parentLabels = [...new Set([TYPE_LABELS.STORY, SPECIAL_LABELS.RIG_CREATED, ...defaultLabels])];
    let parentNumber: number;
    try {
      this.logger.command('gh issue create (parent)');
      parentNumber = await this.github.createIssue({
        title: parentIssue.title,
        body: parentIssue.body,
        labels: parentLabels,
      });
    } catch (error) {
      this.logger.error(`Failed to create parent story: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return;
    }

    const repoName = await this.github.repoName();
    console.log('');
    this.logger.success(`Parent story #${parentNumber} created`);
    console.log(`  https://github.com/${repoName}/issues/${parentNumber}`);

    // Decompose into child issues
    let childIssues;
    try {
      this.logger.command('claude -p <prompt> --output-format json');
      const startTime = Date.now();
      childIssues = await this.logger.spinner(
        this.llm.decomposeStory(specContent, parentNumber),
        'Decomposing spec into atomic issues...'
      );
      this.logger.timing('Decomposition', Date.now() - startTime);
    } catch (error) {
      this.logger.error(`Failed to decompose story: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return;
    }

    // Preview child issues
    console.log('');
    this.logger.header('Child Issues');
    this.logger.info(`${childIssues.length} issues to create:`);
    console.log('');
    for (const child of childIssues) {
      console.log(`  - ${child.title}`);
    }

    const childConfirmed = await this.confirm(`\nCreate ${childIssues.length} child issues? (y/n): `);
    if (!childConfirmed) {
      this.logger.warn('Child issue creation cancelled.');
      return;
    }

    // Create child issues
    const createdNumbers: number[] = [];
    for (const child of childIssues) {
      const childLabels = [...new Set([SPECIAL_LABELS.RIG_CREATED, ...(child.labels || []), ...defaultLabels])];
      try {
        const num = await this.github.createIssue({
          title: child.title,
          body: child.body,
          labels: childLabels,
        });
        createdNumbers.push(num);
        this.logger.success(`  #${num}: ${child.title}`);
      } catch (error) {
        this.logger.error(`Failed to create child issue "${child.title}": ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Summary
    console.log('');
    this.logger.header('Summary');
    console.log(`  Parent: https://github.com/${repoName}/issues/${parentNumber}`);
    for (const num of createdNumbers) {
      console.log(`  Child:  https://github.com/${repoName}/issues/${num}`);
    }
    this.logger.success(`Created ${createdNumbers.length} child issues for story #${parentNumber}`);
  }

  private displayPreview(label: string, title: string, body: string): void {
    console.log('');
    this.logger.header(label);
    console.log('');
    this.logger.info('Title:');
    console.log(`  ${title}`);
    console.log('');
    this.logger.info('Body:');
    body.split('\n').forEach(line => {
      console.log(`  ${line}`);
    });
  }
}
