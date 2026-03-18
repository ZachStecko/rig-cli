import { GitHubService } from './github.service.js';
import { GitService } from './git.service.js';
import { TemplateEngine } from './template-engine.service.js';
import { ComponentType } from '../types/issue.types.js';
import { RigConfig } from '../types/config.types.js';
import { readFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * PromptBuilderService constructs prompts for Claude agent sessions.
 *
 * Loads templates, fetches issue data, and assembles complete prompts
 * with all necessary context for the agent to implement, fix, or review changes.
 */
export class PromptBuilderService {
  private github: GitHubService;
  private git: GitService;
  private templateEngine: TemplateEngine;

  /**
   * Creates a new PromptBuilderService instance.
   *
   * @param github - GitHubService for fetching issue data
   * @param git - GitService for git operations
   * @param templateEngine - TemplateEngine for rendering templates
   */
  constructor(
    github: GitHubService,
    git: GitService,
    templateEngine: TemplateEngine
  ) {
    this.github = github;
    this.git = git;
    this.templateEngine = templateEngine;
  }

  /**
   * Detects component type from issue labels.
   *
   * Labels checked (case-insensitive):
   * - "backend" → backend
   * - "frontend" → frontend
   * - "devnet" → devnet
   * - "fullstack" → fullstack
   *
   * If multiple component labels exist, returns "fullstack".
   * If no component labels, returns "fullstack" as default.
   *
   * @param labels - Array of label names
   * @returns Detected component type
   */
  detectComponent(labels: string[], configuredComponents?: string[]): ComponentType {
    const lowercaseLabels = labels.map(l => l.toLowerCase());

    const hasBackend = lowercaseLabels.includes('backend');
    const hasFrontend = lowercaseLabels.includes('frontend');
    const hasDevnet = lowercaseLabels.includes('devnet');
    const hasFullstack = lowercaseLabels.includes('fullstack');
    const hasNode = lowercaseLabels.includes('node');

    // If explicitly labeled, use the label
    if (hasFullstack) return 'fullstack';
    if (hasNode) return 'node';

    const componentCount = [hasBackend, hasFrontend, hasDevnet].filter(Boolean).length;
    if (componentCount > 1) return 'fullstack';

    if (hasBackend) return 'backend';
    if (hasFrontend) return 'frontend';
    if (hasDevnet) return 'devnet';

    // No label — use what's configured in .rig.yml
    if (configuredComponents && configuredComponents.length > 0) {
      return configuredComponents[0] as ComponentType;
    }

    return 'backend';
  }

  /**
   * Detects component from issue labels, falling back to what's configured in .rig.yml.
   *
   * @param labels - Array of label names from the issue
   * @param config - RigConfig to read configured components from
   * @returns Detected component type
   */
  detectComponentFromConfig(labels: string[], config: RigConfig): ComponentType {
    const configuredComponents = config.components ? Object.keys(config.components) : [];
    return this.detectComponent(labels, configuredComponents);
  }

  /**
   * Extracts file hints from issue body.
   *
   * Looks for file paths in the issue body. Matches:
   * - Paths with file extensions (e.g., src/foo.ts, api/bar.go)
   * - Paths in code blocks
   * - Relative paths (starting with ./ or ../)
   * - Absolute paths (starting with /)
   *
   * @param body - Issue body text
   * @returns Array of file paths found in the body
   */
  extractFileHints(body: string): string[] {
    if (!body) {
      return [];
    }

    // Match file paths (with extensions like .ts, .go, .tsx, .js, etc.)
    const filePathPattern = /(?:^|\s)([.\/\w-]+\/[\w.-]+\.\w+)/gm;
    const matches = body.matchAll(filePathPattern);

    const files = new Set<string>();
    for (const match of matches) {
      files.add(match[1]);
    }

    return Array.from(files);
  }

  /**
   * Builds allowed tools list for Claude based on component type.
   *
   * Returns comma-separated tool names:
   * - All components: Read, Write, Bash, Grep, Glob
   * - Additional tools may be added based on component
   *
   * @param _component - Component type (reserved for future use)
   * @returns Comma-separated allowed tools
   */
  buildAllowedTools(_component: ComponentType): string {
    // Base tools available to all components
    const baseTools = ['Read', 'Write', 'Bash', 'Grep', 'Glob'];

    // All components get the same base tools for now
    // Could be extended later to restrict based on component
    return baseTools.join(',');
  }

  /**
   * Assembles the main implementation prompt for an issue.
   *
   * Fetches issue data, loads the agent prompt template, and renders it.
   *
   * @param issueNumber - Issue number to implement
   * @returns Rendered prompt text
   */
  async assemblePrompt(issueNumber: number): Promise<string> {
    // Fetch issue data
    const issue = await this.github.viewIssue(issueNumber);

    // Load template
    const templatePath = resolve(__dirname, '../templates/agent-prompt.md');
    const template = await readFile(templatePath, 'utf-8');

    // Prepare template variables
    const vars: Record<string, any> = {
      issue_number: issueNumber,
      issue_title: issue.title,
    };

    // Render template
    return this.templateEngine.render(template, vars);
  }

  /**
   * Assembles a prompt for fixing test or build failures.
   *
   * @param errorOutput - Error output from failed tests/build
   * @returns Rendered fix prompt
   */
  async assembleFixPrompt(errorOutput: string): Promise<string> {
    const prompt = `# Fix Test/Build Failures

The following errors occurred during testing or building:

\`\`\`
${errorOutput}
\`\`\`

## Your Task

Fix the errors shown above:

1. **Analyze the errors** - Understand what's failing and why
2. **Locate the problematic code** - Find the files that need changes
3. **Fix the issues** - Make the necessary corrections
4. **Verify the fix** - Run tests/build again to confirm it works

## Guidelines

- Focus only on fixing the specific errors shown
- Don't make unrelated changes
- Ensure your fixes don't break other tests
- Test thoroughly before completing

## Completion

When fixed, all tests should pass and the build should succeed.
`;

    return prompt;
  }

  /**
   * Assembles a prompt for addressing PR feedback from a user.
   *
   * @param userFeedback - User's feedback/comments on the PR
   * @param prNumber - PR number being addressed
   * @returns Rendered fix prompt
   */
  async assemblePrFixPrompt(userFeedback: string, prNumber: number): Promise<string> {
    // Fetch PR data for context
    const prData = await this.github.viewPr(prNumber);

    const prompt = `# Address PR Feedback

You are working on PR #${prNumber}: ${prData.title}

The user has reviewed the PR and provided the following feedback:

\`\`\`
${userFeedback}
\`\`\`

## Your Task

Address all the feedback provided by the user:

1. **Understand the feedback** - Read through all the user's concerns and requests
2. **Locate the relevant code** - Find the files and sections that need changes
3. **Make the requested changes** - Implement the fixes, improvements, or adjustments
4. **Test your changes** - Ensure everything works correctly
5. **Commit your work** - Create clear, descriptive commits for your changes

## Guidelines

- Address every point raised in the feedback
- If feedback is ambiguous, make reasonable assumptions and document them in commit messages
- Maintain code quality and consistency with the existing codebase
- Don't make unrelated changes beyond what was requested
- Test thoroughly to ensure you haven't broken anything

## Completion

When done, all requested changes should be implemented and the PR should be ready for the user to review again.
`;

    return prompt;
  }

  /**
   * Assembles a code review prompt.
   *
   * Fetches issue data, calculates review size and lenses, and renders review template.
   *
   * @param issueNumber - Issue number being reviewed
   * @param options - Optional configuration
   * @param options.defaultBranch - Default branch name (defaults to "master")
   * @param options.reviewFilePath - Path where review will be saved (defaults to .rig-reviews/issue-N/review-TIMESTAMP.md)
   * @returns Rendered review prompt
   */
  async assembleReviewPrompt(
    issueNumber: number,
    options?: {
      defaultBranch?: string;
      reviewFilePath?: string;
    }
  ): Promise<string> {
    // Fetch issue data
    const issue = await this.github.viewIssue(issueNumber);
    const branch = await this.git.currentBranch();

    // Calculate review size and lenses based on change magnitude
    const diffLines = await this.git.diffLinesVsMaster();
    const fileCount = await this.git.changedFilesCountVsMaster();

    let reviewSize: string;
    let lenses: string;

    if (diffLines < 50 && fileCount <= 2) {
      reviewSize = 'small';
      lenses = 'Skeptic';
    } else if (diffLines <= 200 && fileCount <= 5) {
      reviewSize = 'medium';
      lenses = 'Skeptic, Architect';
    } else {
      reviewSize = 'large';
      lenses = 'Skeptic, Architect, Minimalist';
    }

    const defaultBranch = options?.defaultBranch || 'master';

    // Generate timestamp in format: YYYY-MM-DD-HHMMSS (matches harbourflow)
    const timestamp = new Date()
      .toISOString()
      .replace(/:/g, '')
      .replace(/\..+/, '')
      .replace('T', '-');

    const reviewFilePath =
      options?.reviewFilePath ||
      `.rig-reviews/issue-${issueNumber}/review-${timestamp}.md`;

    // Load template
    const templatePath = resolve(__dirname, '../templates/review-prompt.md');
    const template = await readFile(templatePath, 'utf-8');

    // Prepare template variables
    const vars = {
      issue_number: issueNumber,
      issue_title: issue.title,
      branch: branch,
      intent: `Implement: ${issue.title}`,
      lenses: lenses,
      review_size: reviewSize,
      default_branch: defaultBranch,
      review_file_path: reviewFilePath,
    };

    // Render template
    return this.templateEngine.render(template, vars);
  }
}
