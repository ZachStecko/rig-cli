import { BaseCommand } from './base-command.js';
import { parseIssueFile, IssueFileError, REQUIRED_ISSUE_SECTIONS } from '../services/issue-file.service.js';
import { isValidLabel, getAllValidLabels } from '../types/labels.types.js';

/**
 * CreateIssueCommand files an agent-authored issue file on GitHub.
 *
 * The calling coding agent drafts the full issue (it has the repo
 * context); rig validates the format and files it verbatim.
 *
 * Workflow:
 * 1. Read the structured issue file (--file)
 * 2. Parse: front-matter labels, H1 title, body; validate sections
 * 3. Display preview
 * 4. Confirm and create issue on GitHub
 */
export class CreateIssueCommand extends BaseCommand {
  /**
   * Executes the create issue command.
   *
   * @param options - Command options
   * @param options.file - The structured issue file to read
   * @param options.label - Labels to apply, in addition to front matter
   * @param options.yes - Skip the confirmation prompt (for non-interactive use)
   * @throws Error if preconditions fail or issue creation fails
   */
  async execute(options?: { file?: string; label?: string[]; yes?: boolean }): Promise<void> {
    const rigConfig = this.config.get();

    // Check preconditions
    await this.guard.requireGhAuth();

    this.logger.header('Create GitHub Issue');
    console.log('');

    if (!options?.file) {
      this.logger.error('create-issue requires --file <path> with the structured issue.');
      this.logger.dim('Format: optional "labels: [...]" front matter, one H1 title, then the body.');
      this.logger.dim(`Required body sections: ${REQUIRED_ISSUE_SECTIONS.map(s => `## ${s}`).join(', ')}`);
      process.exit(1);
      return; // For testing
    }

    const content = await this.readMultilineInput(options.file, '');
    if (!content.trim()) {
      this.logger.warn('No issue content provided. Aborting.');
      return;
    }

    // Parse the structured file; the body is filed verbatim
    let issue;
    try {
      issue = parseIssueFile(content);
    } catch (error) {
      if (error instanceof IssueFileError) {
        this.logger.error(error.message);
        process.exit(1);
        return; // For testing
      }
      throw error;
    }

    // Merge labels: front matter + --label flags + config defaults
    const defaultLabels = rigConfig.defaultLabels || [];
    const allLabels = [...new Set([...issue.labels, ...(options.label || []), ...defaultLabels])];

    // Validate labels against defined constants
    const invalidLabels = allLabels.filter(label => !isValidLabel(label));
    if (invalidLabels.length > 0) {
      this.logger.error(`Invalid labels: ${invalidLabels.join(', ')}`);
      this.logger.info('Valid labels are defined in src/types/labels.types.ts');
      this.logger.info(`Examples: ${getAllValidLabels().slice(0, 10).join(', ')}, ...`);
      process.exit(1);
      return; // For testing
    }

    // Display preview
    this.displayPreview(issue.title, issue.body);

    // Confirm creation
    const confirmed = options.yes || (await this.confirm('\nCreate this issue? (y/n): '));
    if (!confirmed) {
      this.logger.warn('Issue creation cancelled.');
      return;
    }

    // Create the issue
    try {
      if (allLabels.length > 0) {
        this.logger.info(`Labels: ${allLabels.join(', ')}`);

        // Ensure all labels exist in the repo before creating the issue
        const createdLabels = await this.github.ensureLabels(allLabels);
        if (createdLabels.length > 0) {
          this.logger.info(`Created missing labels: ${createdLabels.join(', ')}`);
        }
      }

      this.logger.command('gh issue create');
      const issueNumber = await this.github.createIssue({
        title: issue.title,
        body: issue.body,
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
   * Displays a preview of the parsed issue.
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
