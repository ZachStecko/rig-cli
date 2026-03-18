import { CodeAgent } from './agents/base.agent.js';
import { createAgent } from './agents/agent-factory.js';
import { RigConfig } from '../types/config.types.js';
import { getAllValidLabels, isValidLabel } from '../types/labels.types.js';

/**
 * Response from structuring an issue description.
 */
export interface StructuredIssue {
  /** The structured issue title */
  title: string;
  /** The structured issue body */
  body: string;
  /** Labels to apply to the issue */
  labels?: string[];
}

// GitHub's title length limit
const GITHUB_TITLE_MAX_LENGTH = 256;

/**
 * LLMService handles text processing tasks using Claude.
 *
 * Uses the configured agent's prompt() method for simple text completion
 * tasks like structuring issue descriptions.
 */
export class LLMService {
  private agent: CodeAgent;

  constructor(agent?: CodeAgent, config?: RigConfig) {
    this.agent = agent ?? createAgent(config);
  }

  /**
   * Checks if the Claude Agent SDK is available (API key is set).
   *
   * @returns true if the agent is available, false otherwise
   */
  async isAvailable(): Promise<boolean> {
    return this.agent.isAvailable();
  }

  /**
   * Structures a raw issue description into a proper GitHub issue format.
   *
   * Takes user's raw description and uses Claude to create a well-structured
   * issue with a clear title and body. The output is written in a direct,
   * technical style without excessive formatting.
   *
   * @param rawDescription - The user's unstructured issue description
   * @returns Structured issue with title and body
   * @throws Error if API key is not set or API call fails
   */
  async structureIssue(rawDescription: string): Promise<StructuredIssue> {
    // Check if agent is available
    const auth = await this.agent.checkAuth();
    if (!auth.authenticated) {
      throw new Error(auth.error || 'Agent is not available. Check your configuration.');
    }

    // Build the prompt for structuring the issue, with JSON output instruction
    const prompt = this.buildIssuePrompt(rawDescription);
    const validLabels = getAllValidLabels();
    const jsonPrompt = `${prompt}

Respond with ONLY a valid JSON object with "title", "body", and "labels" fields. No markdown fences, no explanation.

For "labels", pick 1-4 from this list based on the issue content: ${validLabels.join(', ')}
Always include one component label (backend, frontend, fullstack, devnet, node, infra, serverless) and one type label (bug, enhancement, feature, refactor, docs, chore, test).`;

    // Call Claude via the agent
    if (!this.agent.prompt) {
      throw new Error('Agent does not support the prompt() method');
    }
    const responseText = await this.agent.prompt(jsonPrompt);

    // Extract JSON from the response — Claude may include preamble text
    // before the actual JSON object when acting as an agent.
    let structured: StructuredIssue;
    try {
      // Try parsing the whole response first (fast path)
      try {
        structured = JSON.parse(responseText.trim()) as StructuredIssue;
      } catch {
        // Response may have markdown code fences or preamble text
        // Find the first { ... } JSON object in the response
        const jsonStart = responseText.indexOf('{');
        const jsonEnd = responseText.lastIndexOf('}');
        if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
          throw new Error('No JSON object found in response');
        }
        const jsonText = responseText.substring(jsonStart, jsonEnd + 1);
        structured = JSON.parse(jsonText) as StructuredIssue;
      }
    } catch (error) {
      throw new Error(
        `Failed to parse structured issue response: ${error instanceof Error ? error.message : 'Unknown error'}\nReceived: ${responseText.substring(0, 500)}`
      );
    }

    // Validate the structured output
    if (!structured.title?.trim()) {
      throw new Error(`LLM returned an empty title`);
    }

    if (!structured.body?.trim()) {
      throw new Error(`LLM returned an empty body`);
    }

    // Enforce GitHub's title length limit
    if (structured.title.length > GITHUB_TITLE_MAX_LENGTH) {
      structured.title = structured.title.substring(0, GITHUB_TITLE_MAX_LENGTH - 3) + '...';
    }

    // Filter labels to only valid ones
    if (structured.labels) {
      structured.labels = structured.labels.filter(l => isValidLabel(l));
    }

    return structured;
  }

  /**
   * Decomposes a planning spec into atomic child issues.
   *
   * Takes a full spec/PRD content and a parent issue number, then uses Claude
   * to break it down into small, independently implementable GitHub issues.
   * Each child issue body includes a reference back to the parent story.
   *
   * @param specContent - The full planning spec / PRD content
   * @param parentIssueNumber - The parent story issue number for cross-referencing
   * @returns Array of structured child issues
   * @throws Error if API key is not set, API call fails, or response cannot be parsed
   */
  async decomposeStory(specContent: string, parentIssueNumber: number): Promise<StructuredIssue[]> {
    const auth = await this.agent.checkAuth();
    if (!auth.authenticated) {
      throw new Error(auth.error || 'Agent is not available. Check your configuration.');
    }

    const validLabels = getAllValidLabels();
    const prompt = `You are decomposing a planning spec into atomic GitHub issues for implementation by Claude Code.

Each issue must be independently implementable — a single developer should be able to pick it up and complete it without needing other issues to be done first (unless explicitly noted as a dependency).

Planning spec:
${specContent}

RULES:
- Only create issues for work explicitly described in the spec. Do not add features, enhancements, or nice-to-haves beyond what the spec explicitly details.
- Each issue must be small and focused — one concern per issue.
- Order issues by implementation dependency (foundational work first).
- Every issue body must start with "Parent story: #${parentIssueNumber}" on the first line, followed by a blank line.
- Use the same issue body format: ## Problem / Motivation, ## Implementation Details, ## Testing Strategy, ## Acceptance Criteria. Skip sections that don't apply.
- Titles: imperative, 50-80 chars, with component prefix if clear (cli: / api: / ui: / etc.)
- No filler prose. Senior engineer to senior engineer tone.

For "labels" on each issue, pick 1-4 from this list: ${validLabels.join(', ')}
Always include one component label and one type label.

Respond with ONLY a valid JSON array of objects, each with "title", "body", and "labels" fields. No markdown fences, no explanation.`;

    if (!this.agent.prompt) {
      throw new Error('Agent does not support the prompt() method');
    }
    const responseText = await this.agent.prompt(prompt);

    let issues: StructuredIssue[];
    try {
      try {
        issues = JSON.parse(responseText.trim()) as StructuredIssue[];
      } catch {
        const jsonStart = responseText.indexOf('[');
        const jsonEnd = responseText.lastIndexOf(']');
        if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
          throw new Error('No JSON array found in response');
        }
        const jsonText = responseText.substring(jsonStart, jsonEnd + 1);
        issues = JSON.parse(jsonText) as StructuredIssue[];
      }
    } catch (error) {
      throw new Error(
        `Failed to parse decomposed issues response: ${error instanceof Error ? error.message : 'Unknown error'}\nReceived: ${responseText.substring(0, 500)}`
      );
    }

    if (!Array.isArray(issues) || issues.length === 0) {
      throw new Error('LLM returned no child issues from spec decomposition');
    }

    for (const issue of issues) {
      if (!issue.title?.trim()) {
        throw new Error('LLM returned a child issue with an empty title');
      }
      if (!issue.body?.trim()) {
        throw new Error('LLM returned a child issue with an empty body');
      }
      if (issue.title.length > GITHUB_TITLE_MAX_LENGTH) {
        issue.title = issue.title.substring(0, GITHUB_TITLE_MAX_LENGTH - 3) + '...';
      }
      if (issue.labels) {
        issue.labels = issue.labels.filter(l => isValidLabel(l));
      }
    }

    return issues;
  }

  /**
   * Builds the prompt for structuring an issue.
   *
   * @param rawDescription - User's raw description
   * @returns Formatted prompt
   */
  private buildIssuePrompt(rawDescription: string): string {
    return `You are writing an implementation spec for Claude Code. Output a GitHub issue that \`rig implement\` will execute — precision over prose.

Raw input:
${rawDescription}

TITLE:
- Imperative, 50-80 chars
- Add component prefix if clear (cli: / api: / ui: / etc.)

BODY — Use exactly these H2 sections in order. Skip a section entirely if it does not apply:

## Problem / Motivation
Concrete symptom or gap in 2-3 sentences.

## Implementation Details
WHAT to build. Be prescriptive:
- File paths to create/modify (e.g., "src/services/auth.service.ts")
- Function/class names
- Type signatures
- Algorithms or data structures
- Code snippets ONLY for complex/tricky logic

Code examples:
\`\`\`typescript
// example code
\`\`\`

When unclear, state assumptions (e.g., "Assuming JWT auth"). If critical info is missing, add "## Questions for Developer" at end.

## Approach
WHY and HOW. Architecture:
- Design pattern (MVC, repository, etc.)
- Layer responsibilities
- Patterns to follow
- Integration points
- Constraints/trade-offs

## Testing Strategy
For code:
- Test file paths if creating new tests
- 3-6 key test cases
- Testing approach (unit/integration/e2e)

For config/docs, describe verification steps.

## Acceptance Criteria
3-8 bulleted, testable outcomes:
- Concrete behaviors (e.g., "\`GET /api/foo\` returns 200")
- Observable, binary pass/fail

## Dependencies
Skip if none. Otherwise:
- npm packages (with versions, e.g., "jsonwebtoken@^9.0.0")
- Config changes (tsconfig.json, .env)
- DB migrations
- Breaking changes

## Notes
Edge cases, performance, security. Omit if nothing to say.

## Questions for Developer
Only if critical details are missing. Omit otherwise.

ANTI-SLOP RULES:
- No "This issue aims to", "This PR will", or filler openers
- No bold (**text**)
- No emoji
- No "Step 1:", "Step 2:" prose
- No sections beyond the eight above
- ALWAYS use \`\`\`language code fences — never just "typescript" without backticks
- Target 300-600 words (fewer for small changes)
- Senior engineer to senior engineer tone
- Zero ambiguity`;
  }

}
