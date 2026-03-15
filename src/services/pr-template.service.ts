import { GitHubService } from './github.service.js';
import { GitService } from './git.service.js';
import { TemplateEngine } from './template-engine.service.js';
import { TestRunnerService } from './test-runner.service.js';
import { readFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ComponentType } from '../types/issue.types.js';
import { existsSync, readdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * PrTemplateService generates pull request body text from templates.
 *
 * Assembles PR descriptions by gathering issue info, commit history, diff stats,
 * test results, and substituting them into the pr-body.md template.
 */
export class PrTemplateService {
  private github: GitHubService;
  private git: GitService;
  private templateEngine: TemplateEngine;
  private testRunner: TestRunnerService;
  private projectRoot: string;

  /**
   * Creates a new PrTemplateService instance.
   *
   * @param github - GitHubService for fetching issue data
   * @param git - GitService for git operations
   * @param templateEngine - TemplateEngine for rendering templates
   * @param testRunner - TestRunnerService for test operations
   * @param projectRoot - Absolute path to project root
   */
  constructor(
    github: GitHubService,
    git: GitService,
    templateEngine: TemplateEngine,
    testRunner: TestRunnerService,
    projectRoot: string
  ) {
    this.github = github;
    this.git = git;
    this.templateEngine = templateEngine;
    this.testRunner = testRunner;
    this.projectRoot = projectRoot;
  }

  /**
   * Generates PR body text from template.
   *
   * Gathers issue info, commit history, diff stats, test results, and demo info,
   * then substitutes them into the pr-body.md template.
   *
   * @param issueNumber - Issue number this PR addresses
   * @param component - Component type (backend/frontend/devnet/fullstack)
   * @returns Rendered PR body text
   */
  async generatePrBody(
    issueNumber: number,
    component: ComponentType
  ): Promise<string> {
    // Fetch issue data
    const issue = await this.github.viewIssue(issueNumber);

    // Build issue summary (first paragraph or title)
    const issueSummary = this.extractSummary(issue.body || '', issue.title);

    // Build issue context (acceptance criteria or implementation section)
    const issueContext = this.extractContext(issue.body || '', issueNumber);

    // Get commit log
    const commitLog = await this.git.logVsMaster();
    const formattedCommitLog = commitLog
      .split('\n')
      .filter(line => line.length > 0)
      .map(line => `- ${line}`)
      .join('\n');

    // Generate AI-powered manual test steps
    const manualTestSteps = await this.generateManualTestSteps(
      issue.body || '',
      issueSummary,
      formattedCommitLog,
      component
    );

    // Load template
    const templatePath = resolve(__dirname, '../templates/pr-body.md');
    const template = await readFile(templatePath, 'utf-8');

    // Prepare template variables
    const vars = {
      issue_number: issueNumber,
      issue_summary: issueSummary,
      issue_context: issueContext,
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
      /(###?\s+(Summary|Description|Overview)[\s\S]*?)(?=\n###|$)/i
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

    // Fallback: Get first paragraph (up to first empty line)
    const firstParagraph = body.split('\n\n')[0];
    const lines = firstParagraph.split('\n').slice(0, 5);

    return lines.join('\n').trim() || title;
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

    // Look for "Acceptance Criteria" section (include heading)
    const acceptanceCriteriaMatch = body.match(
      /(### Acceptance Criteria[\s\S]*?)(?=\n###|$)/i
    );
    if (acceptanceCriteriaMatch) {
      return acceptanceCriteriaMatch[1].trim().split('\n').slice(0, 15).join('\n');
    }

    // Look for "Implementation" section (include heading)
    const implementationMatch = body.match(
      /(### Implementation[\s\S]*?)(?=\n###|$)/i
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
   * @param component - Component type
   * @returns Testing instructions
   */
  private async generateManualTestSteps(
    issueBody: string,
    issueSummary: string,
    commitLog: string,
    component: ComponentType
  ): Promise<string> {
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

  /**
   * Gets fallback manual testing instructions when AI generation fails.
   *
   * @private
   * @param component - Component type
   * @returns Fallback testing instructions
   */
  private getFallbackTestInstructions(component: ComponentType): string {
    switch (component) {
      case 'backend':
        return '1. Test API endpoints using curl or Postman\n2. Verify response formats and status codes\n3. Test error handling with invalid inputs\n4. Check database changes (if applicable)';
      case 'frontend':
        return '1. Test UI changes in the browser\n2. Verify responsive design on different screen sizes\n3. Test user interactions (clicks, forms, navigation)\n4. Check console for errors';
      case 'devnet':
        return '1. Deploy to local devnet\n2. Test smart contract interactions\n3. Verify transaction outcomes\n4. Check event emissions';
      case 'fullstack':
      default:
        return '1. Test end-to-end user flows\n2. Verify frontend-backend integration\n3. Test error handling across the stack\n4. Check data consistency';
    }
  }

  /**
   * Builds test instructions based on component type.
   *
   * @private
   * @param component - Component type
   * @returns Test instructions markdown
   */
  private buildTestInstructions(component: ComponentType): string {
    switch (component) {
      case 'backend':
        return '```bash\ncd backend && go test ./... -v\n```';

      case 'frontend':
        return '```bash\ncd frontend && npm test\ncd frontend && npm run lint\ncd frontend && npm run build\n```';

      case 'devnet':
        return '```bash\ncd devnet && npx vitest run\n```';

      case 'fullstack':
      default:
        // For fullstack/mixed changes, list both test suites separately
        return '```bash\n# Backend tests\ncd backend && go test ./... -v\n\n# Frontend tests\ncd frontend && npm test\ncd frontend && npm run lint\ncd frontend && npm run build\n```';
    }
  }

  /**
   * DISABLED: Demo feature disabled for redesign
   *
   * Builds demo section by checking for demo files.
   *
   * @private
   * @param issueNumber - Issue number
   * @returns Demo section markdown (always empty as feature is disabled)
   */
  private buildDemoSection(issueNumber: number): string {
    // DISABLED: Demo feature disabled for redesign
    return '';

    // const demoDir = resolve(this.projectRoot, `.rig-reviews/issue-${issueNumber}`);
    //
    // if (!existsSync(demoDir)) {
    //   return '_No demo recorded_';
    // }
    //
    // // Check for .gif files (newest first would require fs.stat, keep it simple)
    // try {
    //   const files = readdirSync(demoDir);
    //   const demoFiles = files.filter((f: string) => f.startsWith('demo-') && f.endsWith('.gif'));
    //
    //   if (demoFiles.length > 0) {
    //     // Use the first demo file found
    //     return `![Demo](${demoFiles[0]})`;
    //   }
    //
    //   return `Demo artifacts available in \`.rig-reviews/issue-${issueNumber}/\``;
    // } catch {
    //   return '_No demo recorded_';
    // }
  }
}
