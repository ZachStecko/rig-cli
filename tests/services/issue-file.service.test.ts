import { describe, it, expect } from 'vitest';
import {
  parseIssueFile,
  parseStoryFile,
  missingSections,
  IssueFileError,
} from '../../src/services/issue-file.service.js';

const VALID_BODY = `## Problem / Motivation

Something is broken.

## Implementation Details

Fix it in src/services/foo.service.ts.

## Acceptance Criteria

- It works`;

const VALID_ISSUE = `---
labels: [backend, enhancement]
---
# cli: Fix the thing

${VALID_BODY}
`;

describe('parseIssueFile', () => {
  it('extracts title from the first H1, labels from front matter, body verbatim', () => {
    const parsed = parseIssueFile(VALID_ISSUE);

    expect(parsed.title).toBe('cli: Fix the thing');
    expect(parsed.labels).toEqual(['backend', 'enhancement']);
    expect(parsed.body).toBe(VALID_BODY);
  });

  it('parses a file without front matter to empty labels', () => {
    const parsed = parseIssueFile(`# Title\n\n${VALID_BODY}`);

    expect(parsed.labels).toEqual([]);
    expect(parsed.title).toBe('Title');
  });

  it('supports YAML list-style labels in front matter', () => {
    const content = `---\nlabels:\n  - backend\n  - bug\n---\n# Title\n\n${VALID_BODY}`;

    expect(parseIssueFile(content).labels).toEqual(['backend', 'bug']);
  });

  it('names every missing required section', () => {
    const content = `# Title\n\n## Problem / Motivation\n\nOnly this section.`;

    expect(() => parseIssueFile(content)).toThrow(IssueFileError);
    expect(() => parseIssueFile(content)).toThrow(
      /"## Implementation Details", "## Acceptance Criteria"/
    );
  });

  it('rejects a file with no H1 title', () => {
    expect(() => parseIssueFile(VALID_BODY)).toThrow(/No title found/);
  });

  it('rejects a file with prose before the H1', () => {
    expect(() => parseIssueFile(`some intro\n# Title\n\n${VALID_BODY}`)).toThrow(/No title found/);
  });

  it('rejects an over-length title', () => {
    const content = `# ${'x'.repeat(300)}\n\n${VALID_BODY}`;

    expect(() => parseIssueFile(content)).toThrow(/GitHub allows 256/);
  });

  it('rejects invalid front-matter YAML', () => {
    const content = `---\nlabels: [unclosed\n---\n# Title\n\n${VALID_BODY}`;

    expect(() => parseIssueFile(content)).toThrow(/not valid YAML/);
  });

  it('does not treat H2 or H3 headings as the title', () => {
    expect(() => parseIssueFile(`## Not a title\n\n${VALID_BODY}`)).toThrow(/No title found/);
  });
});

describe('missingSections', () => {
  it('returns empty for a complete body', () => {
    expect(missingSections(VALID_BODY)).toEqual([]);
  });

  it('matches sections case-insensitively', () => {
    const body = VALID_BODY.replace('## Problem / Motivation', '## problem / motivation');

    expect(missingSections(body)).toEqual([]);
  });

  it('lists all missing sections in order', () => {
    expect(missingSections('no sections at all')).toEqual([
      'Problem / Motivation',
      'Implementation Details',
      'Acceptance Criteria',
    ]);
  });
});

const VALID_STORY = `---
labels: [feature]
---
# Build the widget system

The story body describing the whole effort.

## Issue: Add the widget model
labels: [backend]
Model body text.

## Issue: Wire the widget API

API body text.

## Problem / Motivation inside a child is fine.
`;

describe('parseStoryFile', () => {
  it('parses the parent and each "## Issue:" child', () => {
    const story = parseStoryFile(VALID_STORY);

    expect(story.parent.title).toBe('Build the widget system');
    expect(story.parent.labels).toEqual(['feature']);
    expect(story.parent.body).toBe('The story body describing the whole effort.');
    expect(story.children).toHaveLength(2);
    expect(story.children[0]).toEqual({
      title: 'Add the widget model',
      labels: ['backend'],
      body: 'Model body text.',
    });
    expect(story.children[1].title).toBe('Wire the widget API');
    expect(story.children[1].labels).toEqual([]);
    expect(story.children[1].body).toContain('API body text.');
  });

  it('keeps non-Issue H2 headings inside the preceding child body', () => {
    const story = parseStoryFile(VALID_STORY);

    expect(story.children[1].body).toContain('## Problem / Motivation inside a child is fine.');
  });

  it('rejects a story with no children', () => {
    const content = `# Story\n\nBody only.`;

    expect(() => parseStoryFile(content)).toThrow(/No child issues found/);
  });

  it('rejects a child with an empty body', () => {
    const content = `# Story\n\nBody.\n\n## Issue: Empty child\n`;

    expect(() => parseStoryFile(content)).toThrow(/"Empty child" has an empty body/);
  });

  it('rejects an empty parent body', () => {
    const content = `# Story\n\n## Issue: Child\nChild body.`;

    expect(() => parseStoryFile(content)).toThrow(/Story body is empty/);
  });

  it('rejects an invalid child labels line', () => {
    const content = `# Story\n\nBody.\n\n## Issue: Child\nlabels: [unclosed\nChild body.`;

    expect(() => parseStoryFile(content)).toThrow(/invalid labels line/);
  });
});
