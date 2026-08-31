import { parse as parseYaml } from 'yaml';

/**
 * Parsing for agent-authored issue and story files.
 *
 * rig files what it is given: the calling coding agent drafts the full
 * issue content (it has the repo context), and these parsers only
 * extract the title, labels, and body — they never rewrite prose.
 */

/**
 * A parsed issue ready to file: title from the first H1, labels from
 * YAML front matter, body verbatim.
 */
export interface ParsedIssueFile {
  title: string;
  body: string;
  labels: string[];
}

/**
 * A parsed story file: the parent story plus its child issues.
 */
export interface ParsedStoryFile {
  parent: ParsedIssueFile;
  children: ParsedIssueFile[];
}

/**
 * H2 sections an issue body must contain. Kept minimal on purpose:
 * these are the sections a reviewer needs to accept the work.
 */
export const REQUIRED_ISSUE_SECTIONS = [
  'Problem / Motivation',
  'Implementation Details',
  'Acceptance Criteria',
] as const;

// GitHub's title length limit
const GITHUB_TITLE_MAX_LENGTH = 256;

/**
 * Error thrown when an issue or story file does not match the expected
 * format. The message names every problem found, not just the first.
 */
export class IssueFileError extends Error {}

/**
 * Splits optional YAML front matter off the top of a file.
 *
 * Front matter is a leading block delimited by `---` lines. Only the
 * `labels` key is read; other keys are ignored.
 *
 * @param content - The full file content
 * @returns The labels from front matter and the content after it
 */
function splitFrontMatter(content: string): { labels: string[]; rest: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return { labels: [], rest: content };
  }
  let labels: string[] = [];
  try {
    const data = parseYaml(match[1]) as { labels?: unknown } | null;
    if (data && Array.isArray(data.labels)) {
      labels = data.labels.map(String);
    }
  } catch {
    throw new IssueFileError('Front matter is not valid YAML.');
  }
  return { labels, rest: content.slice(match[0].length) };
}

/**
 * Extracts the first H1 as the title and returns the remaining body.
 *
 * @param content - File content after front matter
 * @returns Title and body, or null when no H1 exists
 */
function splitTitle(content: string): { title: string; body: string } | null {
  const match = content.match(/^#\s+(.+)$/m);
  if (!match) {
    return null;
  }
  const title = match[1].trim();
  const afterTitle =
    content.slice(0, match.index).trim() === ''
      ? content.slice((match.index ?? 0) + match[0].length)
      : null;
  if (afterTitle === null) {
    return null;
  }
  return { title, body: afterTitle.trim() };
}

/**
 * Returns the required H2 sections missing from a body.
 *
 * @param body - The issue body markdown
 * @returns Names of missing sections (empty when all are present)
 */
export function missingSections(body: string): string[] {
  return REQUIRED_ISSUE_SECTIONS.filter(section => {
    const escaped = section.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    return !new RegExp(`^##\\s+${escaped}\\s*$`, 'mi').test(body);
  });
}

/**
 * Validates a parsed title against GitHub limits.
 *
 * @param title - The candidate title
 * @param context - Where the title came from, for error messages
 * @throws IssueFileError when the title is empty or too long
 */
function validateTitle(title: string, context: string): void {
  if (!title) {
    throw new IssueFileError(`${context} has an empty title.`);
  }
  if (title.length > GITHUB_TITLE_MAX_LENGTH) {
    throw new IssueFileError(
      `${context} title is ${title.length} characters; GitHub allows ${GITHUB_TITLE_MAX_LENGTH}.`
    );
  }
}

/**
 * Parses a structured issue file.
 *
 * Format: optional `labels: [...]` front matter, a single H1 title,
 * then the body, which is filed verbatim. The body must contain the
 * sections in REQUIRED_ISSUE_SECTIONS.
 *
 * @param content - The file content
 * @returns The parsed issue
 * @throws IssueFileError naming every format problem found
 */
export function parseIssueFile(content: string): ParsedIssueFile {
  const { labels, rest } = splitFrontMatter(content);
  const split = splitTitle(rest);
  if (!split) {
    throw new IssueFileError(
      'No title found. Start the file (after optional front matter) with a single H1 line: "# <issue title>".'
    );
  }
  validateTitle(split.title, 'Issue');
  if (!split.body) {
    throw new IssueFileError('Issue body is empty.');
  }
  const missing = missingSections(split.body);
  if (missing.length > 0) {
    throw new IssueFileError(
      `Issue body is missing required sections: ${missing.map(s => `"## ${s}"`).join(', ')}.`
    );
  }
  return { title: split.title, body: split.body, labels };
}

/**
 * Parses a story file into a parent story and child issues.
 *
 * Format:
 * ```markdown
 * ---
 * labels: [feature, backend]
 * ---
 * # Story title
 * Story body...
 *
 * ## Issue: First child title
 * labels: [backend]
 * Child body...
 *
 * ## Issue: Second child title
 * Child body...
 * ```
 *
 * Each `## Issue:` heading starts a child. An optional `labels: [...]`
 * line directly under the heading sets that child's labels. Child
 * bodies are filed verbatim and are not section-validated — atomic
 * child issues are often too small for the full section set.
 *
 * @param content - The file content
 * @returns The parsed parent and children
 * @throws IssueFileError naming the format problem
 */
export function parseStoryFile(content: string): ParsedStoryFile {
  const { labels, rest } = splitFrontMatter(content);
  const split = splitTitle(rest);
  if (!split) {
    throw new IssueFileError(
      'No story title found. Start the file (after optional front matter) with a single H1 line: "# <story title>".'
    );
  }
  validateTitle(split.title, 'Story');

  const chunks = split.body.split(/^##\s+Issue:\s*/m);
  const parentBody = chunks[0].trim();
  if (!parentBody) {
    throw new IssueFileError('Story body is empty.');
  }
  if (chunks.length < 2) {
    throw new IssueFileError(
      'No child issues found. Mark each child with an H2 line: "## Issue: <child title>".'
    );
  }

  const children = chunks.slice(1).map((chunk, index) => {
    const lineEnd = chunk.indexOf('\n');
    const title = (lineEnd === -1 ? chunk : chunk.slice(0, lineEnd)).trim();
    validateTitle(title, `Child issue ${index + 1}`);
    let body = lineEnd === -1 ? '' : chunk.slice(lineEnd + 1).trim();
    let childLabels: string[] = [];
    const bodyLineEnd = body.indexOf('\n');
    const firstLine = bodyLineEnd === -1 ? body : body.slice(0, bodyLineEnd);
    const labelsLine = firstLine.match(/^labels:\s*(.+)$/);
    if (labelsLine) {
      try {
        const parsed = parseYaml(labelsLine[1]) as unknown;
        if (Array.isArray(parsed)) {
          childLabels = parsed.map(String);
        }
      } catch {
        throw new IssueFileError(`Child issue "${title}" has an invalid labels line.`);
      }
      body = body.slice(firstLine.length).trim();
    }
    if (!body) {
      throw new IssueFileError(`Child issue "${title}" has an empty body.`);
    }
    return { title, body, labels: childLabels };
  });

  return {
    parent: { title: split.title, body: parentBody, labels },
    children,
  };
}
