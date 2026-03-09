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

    // Get diff stats
    const diffStat = await this.git.diffStatVsMaster();

    // Build test instructions based on component
    const testInstructions = this.buildTestInstructions(component);

    // Get test output (simplified - just run summary)
    const testOutput = await this.getTestOutput(component);

    // List new test files
    const newTestFiles = await this.testRunner.listNewTestFiles();
    const newTests =
      newTestFiles.length > 0
        ? newTestFiles.map(f => `- ${f}`).join('\n')
        : '_None_';

    // Demo section
    const demo = this.buildDemoSection(issueNumber);

    // Manual test steps (simplified - just a placeholder for now)
    const manualTestSteps = '_Manual testing steps should be added by the reviewer._';

    // Load template
    const templatePath = resolve(__dirname, '../templates/pr-body.md');
    const template = await readFile(templatePath, 'utf-8');

    // Prepare template variables
    const vars = {
      issue_number: issueNumber,
      issue_summary: issueSummary,
      issue_context: issueContext,
      commit_log: formattedCommitLog || '- No commits',
      diff_stat: diffStat || 'No changes',
      manual_test_steps: manualTestSteps,
      test_instructions: testInstructions,
      test_output: testOutput,
      new_tests: newTests,
      demo: demo,
    };

    // Render template
    return this.templateEngine.render(template, vars);
  }

  /**
   * Extracts summary from issue body (first paragraph or first 5 lines).
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

    // Get first paragraph (up to first empty line)
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
        return '```bash\n# Backend\ncd backend && go test ./... -v\n\n# Frontend\ncd frontend && npm test\ncd frontend && npm run lint\ncd frontend && npm run build\n```';
    }
  }

  /**
   * Gets test output summary (just last few lines).
   *
   * @private
   * @param component - Component type
   * @returns Test output summary
   */
  private async getTestOutput(component: ComponentType): Promise<string> {
    try {
      let result;

      switch (component) {
        case 'backend':
          result = await this.testRunner.runBackendTests();
          break;
        case 'frontend':
          result = await this.testRunner.runFrontendTests();
          break;
        case 'devnet':
          result = await this.testRunner.runDevnetTests();
          break;
        case 'fullstack':
          result = await this.testRunner.runAllTests('fullstack');
          break;
      }

      if (result.skipped) {
        return 'Tests not run (component directory not found)';
      }

      // Extract summary lines (filter first, then take last 10)
      // Match specific test result patterns, not just any line containing these words
      const lines = result.output.split('\n');
      const summaryLines = lines
        .filter(line => line.match(/(Test Files|Test Suites|\d+\s+(passed|failed|tests)|✓|✗|PASS|FAIL|^ok\s|^FAIL\s|^\?\s)/))
        .slice(-10);

      return summaryLines.join('\n') || result.output.split('\n').slice(-5).join('\n');
    } catch {
      return 'Tests not run';
    }
  }

  /**
   * Builds demo section by checking for demo files.
   *
   * @private
   * @param issueNumber - Issue number
   * @returns Demo section markdown
   */
  private buildDemoSection(issueNumber: number): string {
    const demoDir = resolve(this.projectRoot, `.rig-reviews/issue-${issueNumber}`);

    if (!existsSync(demoDir)) {
      return '_No demo recorded_';
    }

    // Check for .gif files (newest first would require fs.stat, keep it simple)
    try {
      const files = readdirSync(demoDir);
      const demoFiles = files.filter((f: string) => f.startsWith('demo-') && f.endsWith('.gif'));

      if (demoFiles.length > 0) {
        // Use the first demo file found
        return `![Demo](${demoFiles[0]})`;
      }

      return `Demo artifacts available in \`.rig-reviews/issue-${issueNumber}/\``;
    } catch {
      return '_No demo recorded_';
    }
  }
}
