import { GitService } from './git.service.js';
import { TemplateEngine } from './template-engine.service.js';
import { Issue } from '../types/issue.types.js';
import { readFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * PrTemplateService generates pull request body text from templates.
 *
 * Assembles PR descriptions by gathering issue info, commit history, diff stats,
 * test results, and substituting them into the pr-body.md template.
 */
export class PrTemplateService {
  private git: GitService;
  private templateEngine: TemplateEngine;

  /**
   * Creates a new PrTemplateService instance.
   *
   * @param git - GitService for git operations
   * @param templateEngine - TemplateEngine for rendering templates
   */
  constructor(git: GitService, templateEngine: TemplateEngine) {
    this.git = git;
    this.templateEngine = templateEngine;
  }

  /**
   * Generates PR body text from template.
   *
   * Uses the already-fetched issue plus commit history, then substitutes
   * them into the pr-body.md template.
   *
   * @param issue - The issue this PR addresses (fetched by the caller)
   * @returns Rendered PR body text
   */
  async generatePrBody(issue: Issue): Promise<string> {
    const issueNumber = issue.number;

    // Build issue summary (first paragraph or title)
    const issueSummary = this.extractSummary(issue.body || '', issue.title);

    // Build issue context (acceptance criteria or implementation section)
    const issueContext = this.extractContext(issue.body || '', issueNumber);

    // Build the short "what this solves" explanation from the issue
    const issueProblem = this.extractProblem(issue.body || '', issueNumber);

    // Get commit log
    const commitLog = await this.git.logVsMaster();
    const formattedCommitLog = commitLog
      .split('\n')
      .filter(line => line.length > 0)
      .map(line => `- ${line}`)
      .join('\n');

    // Generate manual test steps from the issue and commit context
    const manualTestSteps = this.generateManualTestSteps(
      issue.body || '',
      issueSummary,
      formattedCommitLog
    );

    // Load template
    const templatePath = resolve(__dirname, '../templates/pr-body.md');
    const template = await readFile(templatePath, 'utf-8');

    // Prepare template variables
    const vars = {
      issue_number: issueNumber,
      issue_summary: issueSummary,
      issue_context: issueContext,
      issue_problem: issueProblem,
      commit_log: formattedCommitLog || '- No commits',
      manual_test_steps: manualTestSteps,
    };

    // Render template
    return this.templateEngine.render(template, vars);
  }

  /**
   * Extracts summary from issue body (looks for Summary section, then first paragraph).
   *
   * @private
   * @param body - Issue body text
   * @param title - Issue title (fallback if body is empty)
   * @returns Summary text
   */
  private extractSummary(body: string, title: string): string {
    if (!body) {
      return title;
    }

    // First, look for an explicit "Summary", "Description", or "Overview" section
    const summaryMatch = body.match(
      /(###?\s+(Summary|Description|Overview)[\s\S]*?)(?=\n##|$)/i
    );

    if (summaryMatch) {
      // Extract content, remove heading, limit to reasonable length
      const content = summaryMatch[1]
        .replace(/###?\s+(Summary|Description|Overview)/i, '')
        .trim()
        .split('\n')
        .slice(0, 10)
        .join('\n');

      if (content) {
        return content;
      }
    }

    // Fallback: Get first paragraph (up to first empty line). A body that
    // opens with some other heading has no summary prose — use the title,
    // so the heading text is not swallowed into the Summary section.
    const firstParagraph = body.split('\n\n')[0];
    if (/^\s*#/.test(firstParagraph)) {
      return title;
    }
    const lines = firstParagraph.split('\n').slice(0, 5);

    return lines.join('\n').trim() || title;
  }

  /**
   * Extracts a short explanation of what the issue solves or helps fix.
   *
   * Prefers the issue's Problem / Motivation section (rig-structured issues
   * always have one — the issue-writing prompt directs the LLM to keep it
   * to two paragraphs, so the section is used whole); falls back to the
   * prose before the first heading.
   *
   * @private
   * @param body - Issue body text
   * @param issueNumber - Issue number (for fallback message)
   * @returns Explanation text
   */
  private extractProblem(body: string, issueNumber: number): string {
    const fallback = `See issue #${issueNumber} for the problem this change addresses.`;
    if (!body) {
      return fallback;
    }

    // Prefer an explicit problem/motivation-style section
    const problemMatch = body.match(
      /#{2,3}\s+(?:Problem(?:\s*\/\s*Motivation)?|Motivation|Background|Context)[^\n]*\n([\s\S]*?)(?=\n#{1,3}\s|$)/i
    );

    // Fall back to the prose before the first heading; a body that opens
    // with some other heading has no leading prose to use
    const source = problemMatch
      ? problemMatch[1]
      : /^\s*#{1,3}\s/.test(body)
        ? ''
        : body.split(/\n#{1,3}\s/)[0];

    const trimmed = source.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  }

  /**
   * Extracts context from issue body (acceptance criteria or implementation section).
   *
   * @private
   * @param body - Issue body text
   * @param issueNumber - Issue number (for fallback message)
   * @returns Context text (includes section heading)
   */
  private extractContext(body: string, issueNumber: number): string {
    if (!body) {
      return `See issue #${issueNumber} for full details.`;
    }

    // Look for "Acceptance Criteria" section (include heading; H2 or H3 —
    // rig-structured issues use H2 sections)
    const acceptanceCriteriaMatch = body.match(
      /(#{2,3} Acceptance Criteria[\s\S]*?)(?=\n##|$)/i
    );
    if (acceptanceCriteriaMatch) {
      return acceptanceCriteriaMatch[1].trim().split('\n').slice(0, 15).join('\n');
    }

    // Look for "Implementation" section (include heading)
    const implementationMatch = body.match(
      /(#{2,3} Implementation[\s\S]*?)(?=\n##|$)/i
    );
    if (implementationMatch) {
      return implementationMatch[1].trim().split('\n').slice(0, 15).join('\n');
    }

    return `See issue #${issueNumber} for full details.`;
  }

  /**
   * Generates manual testing instructions based on PR context.
   *
   * Analyzes the issue and commits to create specific testing steps.
   *
   * @private
   * @param issueBody - Issue body text
   * @param issueSummary - Issue summary
   * @param commitLog - Formatted commit log
   * @returns Testing instructions
   */
  private generateManualTestSteps(
    issueBody: string,
    issueSummary: string,
    commitLog: string
  ): string {
    // Extract testing section from issue if it exists
    const testingSectionMatch = issueBody.match(
      /(###?\s+(Manual Testing|Testing Steps|How to Test|Testing)[\s\S]*?)(?=\n###|$)/i
    );

    if (testingSectionMatch) {
      // Use testing instructions from issue body
      const content = testingSectionMatch[1]
        .replace(/###?\s+(Manual Testing|Testing Steps|How to Test|Testing)/i, '')
        .trim();

      if (content) {
        return content;
      }
    }

    // Generate context-aware instructions
    const summary = issueSummary.toLowerCase();
    const commits = commitLog.toLowerCase();
    const body = issueBody.toLowerCase();
    const combined = `${summary} ${commits} ${body}`;

    const steps: string[] = [];

    // Analyze what changed and generate specific steps
    if (combined.includes('responsive') || combined.includes('viewport') || combined.includes('mobile')) {
      steps.push('1. Test the page at different viewport widths (mobile: 375px, tablet: 768px, desktop: 1920px)');
      steps.push('2. Verify the layout and images scale correctly at each breakpoint');
    }

    if (combined.includes('button') || combined.includes('click') || combined.includes('ui')) {
      steps.push(`${steps.length + 1}. Test all interactive elements (buttons, forms, links) for functionality`);
    }

    if (combined.includes('api') || combined.includes('endpoint') || combined.includes('backend')) {
      steps.push(`${steps.length + 1}. Test API endpoints using curl or Postman with valid and invalid inputs`);
      steps.push(`${steps.length + 1}. Verify response status codes and error messages`);
    }

    if (combined.includes('css') || combined.includes('style') || combined.includes('design')) {
      steps.push(`${steps.length + 1}. Verify styling matches the design requirements`);
      steps.push(`${steps.length + 1}. Check for visual regressions in browser DevTools`);
    }

    if (combined.includes('error') || combined.includes('validation')) {
      steps.push(`${steps.length + 1}. Test error handling and edge cases`);
    }

    // Add generic step if we have nothing specific
    if (steps.length === 0) {
      steps.push('1. Test the main user flow affected by this change');
      steps.push('2. Verify the changes work as described in the issue');
      steps.push('3. Check for any unintended side effects or regressions');
    }

    return steps.join('\n');
  }
}
