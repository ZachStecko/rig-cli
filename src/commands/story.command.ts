import { BaseCommand } from './base-command.js';
import { parseStoryFile, IssueFileError } from '../services/issue-file.service.js';
import { isValidLabel, getAllValidLabels, TYPE_LABELS, SPECIAL_LABELS } from '../types/labels.types.js';

/**
 * StoryCommand files an agent-authored story file: a parent story issue
 * and its pre-decomposed child issues.
 *
 * The calling coding agent decomposes the spec itself (it has the repo
 * context); rig validates the format and files the issues.
 *
 * Workflow:
 * 1. Read the story file (--file): parent story + "## Issue:" children
 * 2. Display parent preview, get user confirmation
 * 3. Create parent issue with 'story' + 'rig-created' labels
 * 4. Display child issue count/titles, get confirmation
 * 5. Create each child issue with 'rig-created' label and a
 *    "Part of #<parent>" reference
 * 6. Log summary with parent + child URLs
 */
export class StoryCommand extends BaseCommand {
  /**
   * Executes the story command.
   *
   * @param options - Command options
   * @param options.file - The story file to read
   * @param options.yes - Skip confirmation prompts (for non-interactive use)
   */
  async execute(options?: { file?: string; yes?: boolean }): Promise<void> {
    const rigConfig = this.config.get();
    const defaultLabels = rigConfig.defaultLabels || [];

    await this.guard.requireGhAuth();

    this.logger.header('File Story and Child Issues');
    console.log('');

    if (!options?.file) {
      this.logger.error('story requires --file <path> with the parent story and child issues.');
      this.logger.dim('Format: optional "labels: [...]" front matter, one H1 story title, the story body,');
      this.logger.dim('then each child as "## Issue: <title>" with an optional "labels: [...]" first line.');
      process.exit(1);
      return; // For testing
    }

    const content = await this.readMultilineInput(options.file, '');
    if (!content.trim()) {
      this.logger.warn('No story content provided. Aborting.');
      return;
    }

    // Parse the structured file; bodies are filed verbatim
    let story;
    try {
      story = parseStoryFile(content);
    } catch (error) {
      if (error instanceof IssueFileError) {
        this.logger.error(error.message);
        process.exit(1);
        return; // For testing
      }
      throw error;
    }

    // Validate all labels (parent front matter + per-child) up front so
    // a bad label fails before any issue is created.
    const authoredLabels = [
      ...story.parent.labels,
      ...story.children.flatMap(child => child.labels),
    ];
    const invalidLabels = [...new Set(authoredLabels.filter(label => !isValidLabel(label)))];
    if (invalidLabels.length > 0) {
      this.logger.error(`Invalid labels: ${invalidLabels.join(', ')}`);
      this.logger.info('Valid labels are defined in src/types/labels.types.ts');
      this.logger.info(`Examples: ${getAllValidLabels().slice(0, 10).join(', ')}, ...`);
      process.exit(1);
      return; // For testing
    }

    // Preview parent
    this.displayPreview('Parent Story', story.parent.title, story.parent.body);

    const parentConfirmed = options.yes || (await this.confirm('\nCreate parent story? (y/n): '));
    if (!parentConfirmed) {
      this.logger.warn('Story creation cancelled.');
      return;
    }

    // Create parent issue
    const parentLabels = [
      ...new Set([TYPE_LABELS.STORY, SPECIAL_LABELS.RIG_CREATED, ...story.parent.labels, ...defaultLabels]),
    ];

    // Ensure all labels exist in the repo before creating the issue
    const createdLabels = await this.github.ensureLabels(parentLabels);
    if (createdLabels.length > 0) {
      this.logger.info(`Created missing labels: ${createdLabels.join(', ')}`);
    }

    let parentNumber: number;
    try {
      this.logger.command('gh issue create (parent)');
      parentNumber = await this.github.createIssue({
        title: story.parent.title,
        body: story.parent.body,
        labels: parentLabels,
      });
    } catch (error) {
      this.logger.error(`Failed to create parent story: ${error instanceof Error ? error.message : 'Unknown error'}`);
      process.exit(1);
      return; // For testing
    }

    const repoName = await this.github.repoName();
    console.log('');
    this.logger.success(`Parent story #${parentNumber} created`);
    console.log(`  https://github.com/${repoName}/issues/${parentNumber}`);

    // Preview child issues
    console.log('');
    this.logger.header('Child Issues');
    this.logger.info(`${story.children.length} issues to create:`);
    console.log('');
    for (const child of story.children) {
      console.log(`  - ${child.title}`);
    }

    const childConfirmed = options.yes || (await this.confirm(`\nCreate ${story.children.length} child issues? (y/n): `));
    if (!childConfirmed) {
      this.logger.warn('Child issue creation cancelled.');
      return;
    }

    // Ensure all child labels exist before creating issues
    const allChildLabels = [...new Set(
      story.children.flatMap(child => [SPECIAL_LABELS.RIG_CREATED, ...child.labels, ...defaultLabels])
    )];
    const createdChildLabels = await this.github.ensureLabels(allChildLabels);
    if (createdChildLabels.length > 0) {
      this.logger.info(`Created missing labels: ${createdChildLabels.join(', ')}`);
    }

    // Create child issues, each linked back to the parent story
    const createdNumbers: number[] = [];
    for (const child of story.children) {
      const childLabels = [...new Set([SPECIAL_LABELS.RIG_CREATED, ...child.labels, ...defaultLabels])];
      try {
        const num = await this.github.createIssue({
          title: child.title,
          body: `${child.body}\n\nPart of #${parentNumber}`,
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

    const failedCount = story.children.length - createdNumbers.length;
    if (failedCount > 0) {
      this.logger.warn(`${failedCount} of ${story.children.length} child issues failed to create.`);
    }
    if (createdNumbers.length === 0) {
      this.logger.error(`No child issues were created for story #${parentNumber}.`);
      process.exit(1);
      return; // For testing
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
