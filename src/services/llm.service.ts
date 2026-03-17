import { CodeAgent } from './agents/base.agent.js';
import { createAgent } from './agents/agent-factory.js';
import { RigConfig } from '../types/config.types.js';

/**
 * Response from structuring an issue description.
 */
export interface StructuredIssue {
  /** The structured issue title */
  title: string;
  /** The structured issue body */
  body: string;
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
    const jsonPrompt = `${prompt}

Respond with ONLY a valid JSON object with "title" and "body" fields. No markdown fences, no explanation.`;

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

    return structured;
  }

  /**
   * Builds the prompt for structuring an issue.
   *
   * @param rawDescription - User's raw description
   * @returns Formatted prompt
   */
  private buildIssuePrompt(rawDescription: string): string {
    return `You are writing an implementation spec for the Claude Code AI agent. The output will be filed as a GitHub issue that Claude Code reads via \`gh issue view\` and implements via \`rig implement\` — so precision and specificity matter more than prose.

Raw developer input:
${rawDescription}

TITLE:
- Imperative mood, 50-80 characters
- Add a component prefix if obvious (e.g. "cli: ...", "api: ...", "ui: ...")

BODY — use exactly these markdown H2 sections in the order shown. Omit a section only if it genuinely does not apply (e.g., skip Dependencies if none are needed):

## Problem / Motivation
Concrete symptom or gap in 2-4 sentences. No abstract desires.

## Implementation Details
Technical specifics of WHAT to build. Be prescriptive. Specify:
- Exact file paths to create or modify (e.g. "src/services/auth.service.ts")
- Function/class names to add or change
- Type signatures or interfaces needed
- Key data structures or algorithms
- Code snippets for complex algorithms, non-obvious logic, or tricky edge cases

When including code examples, ALWAYS use proper markdown code fences with triple backticks and language identifier:
\`\`\`typescript
// example code here
\`\`\`

Be as specific as possible based on the raw description. When details are unclear:
- State your assumptions explicitly (e.g., "Assuming JWT-based auth with refresh tokens")
- If critical information is missing, add a "## Questions for Developer" section at the end
- Avoid vague placeholders like "TBD" or "details to be determined"

## Approach
High-level WHY and HOW. Architecture and design decisions:
- Overall design pattern (MVC, repository pattern, event-driven, etc.)
- Which architectural layers handle which responsibilities
- What patterns to follow (e.g., "use existing PromptBuilder pattern from prompt-builder.service.ts")
- Integration points with existing systems
- Key constraints or trade-offs
- Why this approach was chosen over alternatives (if relevant)

## Testing Strategy
Specific testing requirements. For code changes:
- Test file paths (e.g., "tests/services/auth.service.test.ts") if new tests are needed
- Key test cases to cover (3-6 specific scenarios)
- Testing approach (unit, integration, e2e)
- What success looks like for tests

For config/documentation changes, describe verification steps instead of unit tests (e.g., "Verify markdown renders correctly on GitHub" or "Run linter to confirm config is valid").

## Acceptance Criteria
3-8 bulleted, testable statements:
- Concrete behaviors (e.g., "\`GET /api/foo\` returns 200 with the new field")
- Observable outcomes, not implementation details
- Binary pass/fail conditions

## Dependencies
**Skip this section entirely** if no dependencies are needed. Include only if applicable:
- New npm packages or imports needed (with version constraints if known, e.g., "jsonwebtoken@^9.0.0")
- Configuration files that must be modified (e.g., tsconfig.json, .env)
- Database migrations or schema changes
- Breaking changes or deprecations that affect other code

## Notes
Edge cases, performance considerations, security implications. Omit this section entirely if there is nothing to say.

## Questions for Developer
**Only include this section if critical details are missing** from the raw input. List specific questions that need answers before implementation can begin. If everything is clear, omit this section entirely.

ANTI-SLOP RULES — strictly follow these:
- No "This issue aims to...", "This PR will...", or similar filler openers
- No inline bold markup (**text**) anywhere in the body
- No emoji anywhere
- No numbered lists with "Step 1:", "Step 2:" in prose sections (use bullets or narrative)
- No sections beyond the eight listed above
- ALWAYS use proper markdown code fences: \`\`\`language for opening and \`\`\` for closing — never output just "typescript" or "javascript" without the backticks
- Target 400-800 words for medium-to-large features (fewer is fine for small changes)
- Write like a senior engineer talking to another senior engineer
- Be concrete and prescriptive — the AI agent needs zero ambiguity`;
  }

}
