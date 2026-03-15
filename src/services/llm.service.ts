import { exec } from '../utils/shell.js';
import { writeFile, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

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
 * Uses the Claude CLI in print mode (-p) for simple text completion tasks
 * like structuring issue descriptions.
 */
export class LLMService {
  /**
   * Checks if the Claude CLI is installed.
   *
   * @returns true if claude is available, false otherwise
   */
  async isInstalled(): Promise<boolean> {
    const result = await exec('claude --version');
    return result.exitCode === 0;
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
   * @throws Error if Claude CLI is not available or API call fails
   */
  async structureIssue(rawDescription: string): Promise<StructuredIssue> {
    // Prevent nested Claude Code sessions
    if (process.env.CLAUDECODE) {
      throw new Error('Cannot call Claude CLI from within a Claude Code session (nested sessions not supported)');
    }

    // Check if Claude is installed
    const installed = await this.isInstalled();
    if (!installed) {
      throw new Error('Claude CLI is not installed. Install it with: npm install -g @anthropic-ai/claude-code');
    }

    // Create a temporary directory for our files
    const tmpDir = await mkdtemp(join(tmpdir(), 'rig-llm-'));
    const promptFile = join(tmpDir, 'prompt.txt');
    const schemaFile = join(tmpDir, 'schema.json');

    try {
      // Build the prompt for structuring the issue
      const prompt = this.buildIssuePrompt(rawDescription);

      // Write prompt and schema to temporary files to avoid shell injection
      await writeFile(promptFile, prompt, 'utf-8');
      await writeFile(schemaFile, JSON.stringify(this.getIssueSchema()), 'utf-8');

      // Call Claude CLI in print mode with JSON output using file references
      const result = await exec(
        `claude -p --output-format json --json-schema "$(cat "${schemaFile}")" < "${promptFile}"`
      );

      if (result.exitCode !== 0) {
        throw new Error(`Failed to structure issue: ${result.stderr}`);
      }

      // Parse and validate the JSON response
      let structured: StructuredIssue;
      try {
        const response = JSON.parse(result.stdout);

        // Claude CLI wraps the structured output in a metadata object
        // Extract the actual structured_output field
        if (response.structured_output) {
          structured = response.structured_output as StructuredIssue;
        } else {
          // Fallback: try to use the response directly (for backward compatibility)
          structured = response as StructuredIssue;
        }
      } catch (error) {
        throw new Error(`Failed to parse structured issue response: ${error instanceof Error ? error.message : 'Unknown error'}\nReceived: ${result.stdout.substring(0, 500)}`);
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
    } finally {
      // Clean up temporary directory and all contents
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
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
- Pseudocode or code snippets for complex algorithms, non-obvious logic, or tricky edge cases

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
- Target 400-800 words for medium-to-large features (fewer is fine for small changes)
- Write like a senior engineer talking to another senior engineer
- Be concrete and prescriptive — the AI agent needs zero ambiguity`;
  }

  /**
   * Gets the JSON schema for structured issue output.
   *
   * @returns JSON schema object
   */
  private getIssueSchema(): object {
    return {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description:
            'Imperative-mood issue title, 50-80 characters. Use a component prefix (e.g. "cli:", "api:", "ui:") when the scope is obvious.',
        },
        body: {
          type: 'string',
          description:
            'Implementation spec with H2 sections: Problem/Motivation, Implementation Details (files, functions, types, code), Approach (architecture, patterns), Testing Strategy (test paths and cases), Acceptance Criteria (testable bullets), Dependencies (optional), Notes (optional), Questions for Developer (optional if details missing). 400-800 words for medium/large features. Senior engineer tone. State assumptions when unclear. Claude Code agent will implement this - be concrete and prescriptive.',
        },
      },
      required: ['title', 'body'],
      additionalProperties: false,
    };
  }
}
