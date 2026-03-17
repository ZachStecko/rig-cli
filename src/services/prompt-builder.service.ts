import { GitHubService } from './github.service.js';
import { GitService } from './git.service.js';
import { TemplateEngine } from './template-engine.service.js';
import { ComponentType } from '../types/issue.types.js';
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
  detectComponent(labels: string[], issueTitle?: string, issueBody?: string): ComponentType {
    const lowercaseLabels = labels.map(l => l.toLowerCase());

    const hasBackend = lowercaseLabels.includes('backend');
    const hasFrontend = lowercaseLabels.includes('frontend');
    const hasDevnet = lowercaseLabels.includes('devnet');
    const hasFullstack = lowercaseLabels.includes('fullstack');
    const hasNode = lowercaseLabels.includes('node');

    // If explicitly labeled fullstack, return it
    if (hasFullstack) {
      return 'fullstack';
    }

    // If explicitly labeled node, return it
    if (hasNode) {
      return 'node';
    }

    // If multiple components, it's fullstack
    const componentCount = [hasBackend, hasFrontend, hasDevnet].filter(Boolean).length;
    if (componentCount > 1) {
      return 'fullstack';
    }

    // Return single component if labeled
    if (hasBackend) return 'backend';
    if (hasFrontend) return 'frontend';
    if (hasDevnet) return 'devnet';

    // No label — infer from issue content
    return this.inferComponentFromContent(issueTitle, issueBody);
  }

  /**
   * Infers the component type from issue title and body when no label is present.
   *
   * Looks for file path patterns and keywords to determine if the change
   * is frontend, backend, or fullstack.
   */
  private inferComponentFromContent(title?: string, body?: string): ComponentType {
    const text = `${title || ''} ${body || ''}`.toLowerCase();

    // Check for file path hints
    const frontendPaths = ['/web/', '/frontend/', '/src/app/', '/src/components/', '/src/pages/', '.tsx', '.jsx', '.css', '.scss', 'tailwind', 'next.config'];
    const backendPaths = ['/api/', '/server/', '/backend/', '/cmd/', '/internal/', '/pkg/', 'go.mod', '.go', 'handler', 'middleware', 'migration'];
    const devnetPaths = ['/devnet/', 'docker-compose', 'devnet'];

    const hasFrontendHints = frontendPaths.some(p => text.includes(p));
    const hasBackendHints = backendPaths.some(p => text.includes(p));
    const hasDevnetHints = devnetPaths.some(p => text.includes(p));

    // Check for UI/UX keywords
    const frontendKeywords = ['button', 'page', 'component', 'ui', 'ux', 'css', 'style', 'layout', 'modal', 'form', 'landing', 'navbar', 'sidebar', 'responsive', 'icon', 'font', 'color', 'theme', 'dark mode', 'animation', 'hover', 'click', 'render', 'react', 'next.js'];
    const backendKeywords = ['endpoint', 'api route', 'database', 'migration', 'schema', 'query', 'grpc', 'rest api', 'middleware', 'authentication', 'authorization'];

    const hasFrontendKeywords = frontendKeywords.some(k => text.includes(k));
    const hasBackendKeywords = backendKeywords.some(k => text.includes(k));

    const frontendScore = (hasFrontendHints ? 2 : 0) + (hasFrontendKeywords ? 1 : 0);
    const backendScore = (hasBackendHints ? 2 : 0) + (hasBackendKeywords ? 1 : 0);

    if (hasDevnetHints) return 'devnet';
    if (frontendScore > 0 && backendScore === 0) return 'frontend';
    if (backendScore > 0 && frontendScore === 0) return 'backend';
    if (frontendScore > 0 && backendScore > 0) return 'fullstack';

    return 'fullstack'; // True fallback when no signals at all
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

    // Default values
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
