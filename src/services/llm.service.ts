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
    return `You are writing an implementation spec for an AI coding agent. The output will be filed as a GitHub issue that another AI agent reads via \`gh issue view\` and implements directly — so precision matters more than prose.

Raw developer input:
${rawDescription}

TITLE:
- Imperative mood, 50-80 characters
- Add a component prefix if obvious (e.g. "cli: ...", "api: ...")

BODY — use exactly these markdown H2 sections. Skip a section only if it genuinely does not apply:

## Problem / Motivation
Concrete symptom or gap in 2-4 sentences. No abstract desires.

## Approach
Which layers, modules, or files are involved. What pattern to follow. Key constraints or trade-offs. If something cannot be inferred from the raw description, write "TBD: <what needs deciding>" instead of guessing.

## Acceptance Criteria
3-8 bulleted, testable statements (e.g. "\`GET /api/foo\` returns 200 with the new field").

## Notes
Edge cases, migrations, dependency changes. Omit this section entirely if there is nothing to say.

ANTI-SLOP RULES — strictly follow these:
- No "This issue aims to...", "This PR will...", or similar filler openers
- No inline bold markup (**text**) anywhere in the body
- No emoji anywhere
- No sections beyond the four listed above
- Target 150-400 words for the body
- Write like a senior engineer talking to another senior engineer`;
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
            'Imperative-mood issue title, 50-80 characters. Use a component prefix (e.g. "cli:", "api:") when the scope is obvious.',
        },
        body: {
          type: 'string',
          description:
            'Implementation spec body using markdown H2 sections: "## Problem / Motivation" (2-4 sentences), "## Approach" (layers, patterns, constraints; use "TBD:" for unknowns), "## Acceptance Criteria" (3-8 testable bullets), and optionally "## Notes" (edge cases, migrations). Target 150-400 words. No emoji, no bold spam, no filler phrases.',
        },
      },
      required: ['title', 'body'],
      additionalProperties: false,
    };
  }
}
