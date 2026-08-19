import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrTemplateService } from '../../src/services/pr-template.service.js';
import { GitService } from '../../src/services/git.service.js';
import { TemplateEngine } from '../../src/services/template-engine.service.js';
import { Issue } from '../../src/types/issue.types.js';
import { readFile } from 'fs/promises';

vi.mock('fs/promises');

describe('PrTemplateService', () => {
  let service: PrTemplateService;
  let mockGit: GitService;
  let mockTemplateEngine: TemplateEngine;

  const makeIssue = (overrides: Partial<Issue> = {}): Issue => ({
    number: 42,
    title: 'Add user authentication',
    body: 'This implements user auth.',
    labels: [],
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();

    mockGit = {
      logVsMaster: vi.fn(),
    } as any;

    mockTemplateEngine = {
      render: vi.fn(),
    } as any;

    service = new PrTemplateService(mockGit, mockTemplateEngine);

    vi.mocked(readFile).mockResolvedValue('template content');
    vi.mocked(mockGit.logVsMaster).mockResolvedValue('commit');
    vi.mocked(mockTemplateEngine.render).mockReturnValue('rendered');
  });

  const renderedVars = () => vi.mocked(mockTemplateEngine.render).mock.calls[0][1];

  describe('generatePrBody', () => {
    it('generates PR body with all sections', async () => {
      const issue = makeIssue({
        body: 'This implements user auth.\n\n### Acceptance Criteria\n- Users can log in\n- Sessions persist',
      });

      vi.mocked(mockGit.logVsMaster).mockResolvedValue('abc123 Initial commit\ndef456 Add tests');
      vi.mocked(mockTemplateEngine.render).mockReturnValue('rendered PR body');

      const result = await service.generatePrBody(issue);

      expect(result).toBe('rendered PR body');
      expect(mockGit.logVsMaster).toHaveBeenCalled();

      const vars = renderedVars();
      expect(vars.issue_number).toBe(42);
      expect(vars.issue_summary).toContain('This implements user auth');
      expect(vars.issue_context).toContain('### Acceptance Criteria');
      expect(vars.issue_context).toContain('Users can log in');
      expect(vars.commit_log).toBe('- abc123 Initial commit\n- def456 Add tests');
      expect(vars.manual_test_steps).toBeDefined();
      expect(vars.issue_problem).toBeDefined();
    });

    it('handles empty commit log', async () => {
      vi.mocked(mockGit.logVsMaster).mockResolvedValue('');

      await service.generatePrBody(makeIssue({ number: 46 }));

      expect(renderedVars().commit_log).toBe('- No commits');
    });
  });

  describe('extractSummary', () => {
    it('returns title when body is empty', async () => {
      await service.generatePrBody(makeIssue({ title: 'Test Title', body: '' }));

      expect(renderedVars().issue_summary).toBe('Test Title');
    });

    it('extracts first paragraph from body', async () => {
      await service.generatePrBody(
        makeIssue({ body: 'First paragraph line 1\nFirst paragraph line 2\n\nSecond paragraph' })
      );

      const vars = renderedVars();
      expect(vars.issue_summary).toBe('First paragraph line 1\nFirst paragraph line 2');
      expect(vars.issue_summary).not.toContain('Second paragraph');
    });

    it('returns title when body opens with a non-summary heading', async () => {
      await service.generatePrBody(
        makeIssue({
          title: 'Fix session expiry',
          body: '## Problem / Motivation\nSessions expire too fast.',
        })
      );

      expect(renderedVars().issue_summary).toBe('Fix session expiry');
    });

    it('limits summary to first 5 lines', async () => {
      await service.generatePrBody(
        makeIssue({ body: 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7' })
      );

      const vars = renderedVars();
      expect(vars.issue_summary).toBe('Line 1\nLine 2\nLine 3\nLine 4\nLine 5');
      expect(vars.issue_summary).not.toContain('Line 6');
    });
  });

  describe('extractProblem', () => {
    it('returns fallback when body is empty', async () => {
      await service.generatePrBody(makeIssue({ number: 10, body: '' }));

      expect(renderedVars().issue_problem).toBe(
        'See issue #10 for the problem this change addresses.'
      );
    });

    it('extracts the Problem / Motivation section', async () => {
      await service.generatePrBody(
        makeIssue({
          body: `## Problem / Motivation
Login sessions expire after 5 minutes, logging users out mid-task.

## Implementation Details
Bump the session TTL.`,
        })
      );

      const vars = renderedVars();
      expect(vars.issue_problem).toBe(
        'Login sessions expire after 5 minutes, logging users out mid-task.'
      );
      expect(vars.issue_problem).not.toContain('Implementation');
    });

    it('uses the whole problem section without truncation', async () => {
      await service.generatePrBody(
        makeIssue({
          body: `## Problem / Motivation
Paragraph one.

Paragraph two.

Paragraph three.

## Acceptance Criteria
- Done`,
        })
      );

      expect(renderedVars().issue_problem).toBe(
        'Paragraph one.\n\nParagraph two.\n\nParagraph three.'
      );
    });

    it('falls back to prose before the first heading', async () => {
      await service.generatePrBody(
        makeIssue({
          body: `The CLI crashes on startup when the config file is missing.

## Implementation Details
Add a guard.`,
        })
      );

      expect(renderedVars().issue_problem).toBe(
        'The CLI crashes on startup when the config file is missing.'
      );
    });

    it('returns fallback when the body has headings but no leading prose or problem section', async () => {
      await service.generatePrBody(
        makeIssue({ number: 14, body: `## Implementation Details\nAdd a guard.` })
      );

      expect(renderedVars().issue_problem).toBe(
        'See issue #14 for the problem this change addresses.'
      );
    });
  });

  describe('extractContext', () => {
    it('returns fallback when body is empty', async () => {
      await service.generatePrBody(makeIssue({ number: 10, body: '' }));

      expect(renderedVars().issue_context).toBe('See issue #10 for full details.');
    });

    it('extracts Acceptance Criteria section', async () => {
      await service.generatePrBody(
        makeIssue({
          body: `Description here

### Acceptance Criteria
- Users can login
- Sessions persist
- Errors handled

### Implementation
Some implementation notes`,
        })
      );

      const vars = renderedVars();
      expect(vars.issue_context).toContain('### Acceptance Criteria');
      expect(vars.issue_context).toContain('Users can login');
      expect(vars.issue_context).toContain('Sessions persist');
      expect(vars.issue_context).not.toContain('Implementation');
    });

    it('extracts H2 Acceptance Criteria section (rig-structured issues)', async () => {
      await service.generatePrBody(
        makeIssue({
          body: `## Problem / Motivation
Something is broken.

## Acceptance Criteria
- Users can login

## Notes
Extra notes`,
        })
      );

      const vars = renderedVars();
      expect(vars.issue_context).toContain('## Acceptance Criteria');
      expect(vars.issue_context).toContain('Users can login');
      expect(vars.issue_context).not.toContain('Extra notes');
    });

    it('extracts Implementation section if no Acceptance Criteria', async () => {
      await service.generatePrBody(
        makeIssue({
          body: `Description here

### Implementation
Step 1: Do this
Step 2: Do that`,
        })
      );

      const vars = renderedVars();
      expect(vars.issue_context).toContain('### Implementation');
      expect(vars.issue_context).toContain('Step 1: Do this');
      expect(vars.issue_context).toContain('Step 2: Do that');
    });

    it('limits context to 15 lines', async () => {
      const longContext = Array.from({ length: 20 }, (_, i) => `- Criterion ${i + 1}`).join('\n');

      await service.generatePrBody(
        makeIssue({ body: `### Acceptance Criteria\n${longContext}` })
      );

      const vars = renderedVars();
      const lines = vars.issue_context.split('\n');
      expect(lines.length).toBeLessThanOrEqual(15);
      expect(vars.issue_context).toContain('### Acceptance Criteria');
      expect(vars.issue_context).toContain('Criterion 1');
      expect(vars.issue_context).toContain('Criterion 14'); // Only 14 criteria lines fit (heading takes 1 line)
      expect(vars.issue_context).not.toContain('Criterion 15');
    });

    it('returns fallback if no Acceptance Criteria or Implementation', async () => {
      await service.generatePrBody(
        makeIssue({ number: 14, body: `### Description\nSome description\n\n### Notes\nSome notes` })
      );

      expect(renderedVars().issue_context).toBe('See issue #14 for full details.');
    });
  });
});
