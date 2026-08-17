import { BaseCommand } from './base-command.js';
import { Issue } from '../types/issue.types.js';
import { copyToClipboard } from '../utils/clipboard.js';

/**
 * GrabCommand copies an issue's title and body to the clipboard.
 *
 * Bridges rig's issue workflow to the user's coding tool: grab the issue,
 * paste it into Claude/Cursor/etc. to implement, then open the PR with
 * rig pr. If the clipboard is unavailable, the issue is printed instead.
 */
export class GrabCommand extends BaseCommand {
  /**
   * Executes the grab command.
   *
   * @param issueArg - The issue number to copy; when omitted, lists open
   *   issues and prompts the user to pick one
   */
  async execute(issueArg?: string): Promise<void> {
    await this.guard.requireGhAuth();

    let trimmed = issueArg?.trim() ?? '';
    if (!trimmed) {
      const selected = await this.pickIssue();
      if (selected === null) {
        return;
      }
      trimmed = selected;
    }

    const issueNumber = /^\d+$/.test(trimmed) ? parseInt(trimmed, 10) : NaN;
    if (isNaN(issueNumber) || issueNumber <= 0) {
      this.logger.error(`Invalid issue number: ${trimmed}`);
      process.exit(1);
      return; // For testing
    }

    let issue: Issue;
    try {
      issue = await this.github.viewIssue(issueNumber);
    } catch (error) {
      this.logger.error(`Cannot fetch issue #${issueNumber}: ${(error as Error).message}`);
      process.exit(1);
      return; // For testing
    }

    const text = this.formatIssue(issue);

    try {
      await copyToClipboard(text);
      this.logger.success(`Issue #${issue.number} copied to clipboard (${text.length} chars)`);
      this.logger.dim(`  ${issue.title}`);
      this.logger.dim(`  Paste it into your coding tool; branch as issue-${issue.number}-short-slug, then rig pr.`);
    } catch (error) {
      this.logger.warn(`Clipboard unavailable (${(error as Error).message}); printing instead:`);
      console.log('');
      console.log(text);
    }
  }

  /**
   * Lists open issues and prompts the user to pick one.
   *
   * @returns The entered issue number as a string, or null if there are no
   *   open issues or the user aborted
   */
  private async pickIssue(): Promise<string | null> {
    let issues: Pick<Issue, 'number' | 'title' | 'labels'>[];
    try {
      issues = await this.github.listOpenIssues();
    } catch (error) {
      this.logger.error(`Cannot list issues: ${(error as Error).message}`);
      process.exit(1);
      return null; // For testing
    }

    if (issues.length === 0) {
      this.logger.info('No open issues found.');
      return null;
    }

    this.logger.header('Open Issues');
    console.log('');
    for (const issue of issues) {
      const labels = issue.labels.map(label => label.name).join(', ');
      console.log(`  #${issue.number}  ${issue.title}${labels ? `  [${labels}]` : ''}`);
    }
    console.log('');

    const answer = (await this.promptLine('Issue number to grab: ')).trim();
    if (!answer) {
      this.logger.warn('No issue selected. Aborting.');
      return null;
    }
    return answer;
  }

  /**
   * Formats an issue as markdown for pasting into a coding tool.
   *
   * @param issue - The issue to format
   * @returns Markdown text with title heading and body
   */
  private formatIssue(issue: Issue): string {
    const body = issue.body?.trim() || '(no body)';
    return `# ${issue.title} (#${issue.number})\n\n${body}\n`;
  }
}
