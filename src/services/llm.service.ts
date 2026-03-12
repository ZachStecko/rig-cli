import { exec } from '../utils/shell.js';
import { writeFile, unlink, mkdtemp } from 'fs/promises';
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
        structured = JSON.parse(result.stdout) as StructuredIssue;
      } catch (error) {
        throw new Error(`Failed to parse structured issue response: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      // Validate the structured output
      if (!structured.title?.trim()) {
        throw new Error('LLM returned an empty title');
      }

      if (!structured.body?.trim()) {
        throw new Error('LLM returned an empty body');
      }

      // Enforce GitHub's title length limit
      if (structured.title.length > GITHUB_TITLE_MAX_LENGTH) {
        structured.title = structured.title.substring(0, GITHUB_TITLE_MAX_LENGTH - 3) + '...';
      }

      return structured;
    } finally {
      // Clean up temporary files
      try {
        await unlink(promptFile).catch(() => {});
        await unlink(schemaFile).catch(() => {});
        await unlink(tmpDir).catch(() => {});
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Builds the prompt for structuring an issue.
   *
   * @param rawDescription - User's raw description
   * @returns Formatted prompt
   */
  private buildIssuePrompt(rawDescription: string): string {
    return `You are structuring a GitHub issue from a developer's raw description.

CRITICAL RULES:
1. Write like a senior developer - direct, technical, no corporate speak
2. NO excessive markdown formatting (no bold everywhere, no fancy headers)
3. Be clear and concise
4. A bit of developer personality is good - don't be a robot
5. Focus on technical details and context

Raw description:
${rawDescription}

Create a GitHub issue with:
- A clear, concise title (50-80 chars)
- A body with relevant technical details, context, and any reproduction steps or acceptance criteria

Return ONLY a JSON object with "title" and "body" fields.`;
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
          description: 'Issue title (50-80 characters)',
        },
        body: {
          type: 'string',
          description: 'Issue body with technical details and context',
        },
      },
      required: ['title', 'body'],
    };
  }
}
