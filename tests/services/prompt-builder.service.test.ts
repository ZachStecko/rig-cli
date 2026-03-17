import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PromptBuilderService } from '../../src/services/prompt-builder.service.js';
import { GitHubService } from '../../src/services/github.service.js';
import { GitService } from '../../src/services/git.service.js';
import { TemplateEngine } from '../../src/services/template-engine.service.js';
import { Issue } from '../../src/types/issue.types.js';

describe('PromptBuilderService', () => {
  let promptBuilder: PromptBuilderService;
  let mockGitHub: GitHubService;
  let mockGit: GitService;
  let mockTemplateEngine: TemplateEngine;

  beforeEach(() => {
    // Create mock instances
    mockGitHub = {
      viewIssue: vi.fn(),
      issueLabels: vi.fn(),
    } as any;

    mockGit = {
      currentBranch: vi.fn(),
      diffLinesVsMaster: vi.fn(),
      changedFilesCountVsMaster: vi.fn(),
    } as any;

    mockTemplateEngine = {
      render: vi.fn(),
    } as any;

    promptBuilder = new PromptBuilderService(
      mockGitHub,
      mockGit,
      mockTemplateEngine
    );
  });

  describe('detectComponent', () => {
    it('returns backend for backend label', () => {
      const result = promptBuilder.detectComponent(['backend']);
      expect(result).toBe('backend');
    });

    it('returns frontend for frontend label', () => {
      const result = promptBuilder.detectComponent(['frontend']);
      expect(result).toBe('frontend');
    });

    it('returns devnet for devnet label', () => {
      const result = promptBuilder.detectComponent(['devnet']);
      expect(result).toBe('devnet');
    });

    it('returns fullstack for fullstack label', () => {
      const result = promptBuilder.detectComponent(['fullstack']);
      expect(result).toBe('fullstack');
    });

    it('returns fullstack when multiple component labels exist', () => {
      const result = promptBuilder.detectComponent(['backend', 'frontend']);
      expect(result).toBe('fullstack');
    });

    it('returns fullstack when backend and devnet labels exist', () => {
      const result = promptBuilder.detectComponent(['backend', 'devnet']);
      expect(result).toBe('fullstack');
    });

    it('returns fullstack when frontend and devnet labels exist', () => {
      const result = promptBuilder.detectComponent(['frontend', 'devnet']);
      expect(result).toBe('fullstack');
    });

    it('returns fullstack when all three component labels exist', () => {
      const result = promptBuilder.detectComponent(['backend', 'frontend', 'devnet']);
      expect(result).toBe('fullstack');
    });

    it('returns first configured component when no component labels exist', () => {
      const result = promptBuilder.detectComponent(['bug', 'priority:high'], ['node']);
      expect(result).toBe('node');
    });

    it('returns backend as default when no labels and no configured components', () => {
      const result = promptBuilder.detectComponent([]);
      expect(result).toBe('backend');
    });

    it('returns configured component for empty labels array', () => {
      const result = promptBuilder.detectComponent([], ['node']);
      expect(result).toBe('node');
    });

    it('is case-insensitive for component labels', () => {
      expect(promptBuilder.detectComponent(['BACKEND'])).toBe('backend');
      expect(promptBuilder.detectComponent(['Frontend'])).toBe('frontend');
      expect(promptBuilder.detectComponent(['DevNet'])).toBe('devnet');
      expect(promptBuilder.detectComponent(['FULLSTACK'])).toBe('fullstack');
    });

    it('ignores non-component labels', () => {
      const result = promptBuilder.detectComponent(['bug', 'backend', 'priority:high']);
      expect(result).toBe('backend');
    });

    it('prefers explicit fullstack label over multiple components', () => {
      const result = promptBuilder.detectComponent(['backend', 'frontend', 'fullstack']);
      expect(result).toBe('fullstack');
    });

    it('returns node for node label', () => {
      const result = promptBuilder.detectComponent(['node']);
      expect(result).toBe('node');
    });

    it('uses configured components when no labels match', () => {
      const result = promptBuilder.detectComponent(['bug'], ['backend']);
      expect(result).toBe('backend');
    });

    it('uses first configured component when multiple configured', () => {
      const result = promptBuilder.detectComponent([], ['backend', 'frontend']);
      expect(result).toBe('backend');
    });

    it('uses configured node component when only node is configured', () => {
      const result = promptBuilder.detectComponent([], ['node']);
      expect(result).toBe('node');
    });
  });

  describe('extractFileHints', () => {
    it('extracts file paths from issue body', () => {
      const body = 'Please update src/services/auth.ts and api/handlers/user.go';
      const result = promptBuilder.extractFileHints(body);
      expect(result).toContain('src/services/auth.ts');
      expect(result).toContain('api/handlers/user.go');
    });

    it('extracts paths starting with ./', () => {
      const body = 'Check ./components/Button.tsx for the issue';
      const result = promptBuilder.extractFileHints(body);
      expect(result).toContain('./components/Button.tsx');
    });

    it('extracts paths starting with ../', () => {
      const body = 'Relative path ../shared/utils.ts needs changes';
      const result = promptBuilder.extractFileHints(body);
      expect(result).toContain('../shared/utils.ts');
    });

    it('extracts paths in code blocks', () => {
      const body = `
Update these files:
\`\`\`
src/index.ts
lib/parser.js
\`\`\`
`;
      const result = promptBuilder.extractFileHints(body);
      expect(result).toContain('src/index.ts');
      expect(result).toContain('lib/parser.js');
    });

    it('extracts multiple file extensions', () => {
      const body = 'Files: src/app.ts, api/main.go, web/index.tsx, tests/unit.test.js';
      const result = promptBuilder.extractFileHints(body);
      expect(result).toContain('src/app.ts');
      expect(result).toContain('api/main.go');
      expect(result).toContain('web/index.tsx');
      expect(result).toContain('tests/unit.test.js');
    });

    it('returns empty array for body with no file paths', () => {
      const body = 'This is a general issue with no specific files mentioned';
      const result = promptBuilder.extractFileHints(body);
      expect(result).toEqual([]);
    });

    it('returns empty array for empty body', () => {
      const result = promptBuilder.extractFileHints('');
      expect(result).toEqual([]);
    });

    it('returns empty array for null body', () => {
      const result = promptBuilder.extractFileHints(null as any);
      expect(result).toEqual([]);
    });

    it('deduplicates file paths', () => {
      const body = 'Update src/app.ts and also check src/app.ts again';
      const result = promptBuilder.extractFileHints(body);
      expect(result.filter(f => f === 'src/app.ts')).toHaveLength(1);
    });

    it('handles paths with dashes and underscores', () => {
      const body = 'Files: src/some-file_name.ts, api/my_handler-v2.go';
      const result = promptBuilder.extractFileHints(body);
      expect(result).toContain('src/some-file_name.ts');
      expect(result).toContain('api/my_handler-v2.go');
    });

    it('extracts paths at start of line', () => {
      const body = 'src/main.ts is the entry point';
      const result = promptBuilder.extractFileHints(body);
      expect(result).toContain('src/main.ts');
    });
  });

  describe('buildAllowedTools', () => {
    it('returns base tools for backend component', () => {
      const result = promptBuilder.buildAllowedTools('backend');
      expect(result).toBe('Read,Write,Bash,Grep,Glob');
    });

    it('returns base tools for frontend component', () => {
      const result = promptBuilder.buildAllowedTools('frontend');
      expect(result).toBe('Read,Write,Bash,Grep,Glob');
    });

    it('returns base tools for devnet component', () => {
      const result = promptBuilder.buildAllowedTools('devnet');
      expect(result).toBe('Read,Write,Bash,Grep,Glob');
    });

    it('returns base tools for fullstack component', () => {
      const result = promptBuilder.buildAllowedTools('fullstack');
      expect(result).toBe('Read,Write,Bash,Grep,Glob');
    });

    it('returns comma-separated string', () => {
      const result = promptBuilder.buildAllowedTools('backend');
      expect(result).toMatch(/^[A-Za-z]+(,[A-Za-z]+)*$/);
    });
  });

  describe('assemblePrompt', () => {
    const mockIssue: Issue = {
      number: 42,
      title: 'Add user authentication',
      body: 'Implement JWT auth in src/auth.ts',
      state: 'open',
      labels: [
        { name: 'backend' },
        { name: 'priority:high' },
      ],
      assignees: [],
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    };

    beforeEach(() => {
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue(mockIssue);
      vi.mocked(mockTemplateEngine.render).mockReturnValue('Rendered prompt');
    });

    it('fetches issue data from GitHub', async () => {
      await promptBuilder.assemblePrompt(42);

      expect(mockGitHub.viewIssue).toHaveBeenCalledWith(42);
    });

    it('renders template with correct variables', async () => {
      await promptBuilder.assemblePrompt(42);

      expect(mockTemplateEngine.render).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          issue_number: 42,
          issue_title: 'Add user authentication',
        })
      );
    });

    it('reads agent-prompt.md template', async () => {
      await promptBuilder.assemblePrompt(42);

      const renderCall = vi.mocked(mockTemplateEngine.render).mock.calls[0];
      const template = renderCall[0];
      expect(template).toContain('# Implementation Task');
    });

    it('returns rendered prompt string', async () => {
      const result = await promptBuilder.assemblePrompt(42);

      expect(result).toBe('Rendered prompt');
    });
  });

  describe('assembleFixPrompt', () => {
    it('includes error output in prompt', async () => {
      const errorOutput = 'TypeError: Cannot read property "foo" of undefined\n  at test.ts:42';
      const result = await promptBuilder.assembleFixPrompt(errorOutput);

      expect(result).toContain(errorOutput);
    });

    it('includes task instructions', async () => {
      const result = await promptBuilder.assembleFixPrompt('Some error');

      expect(result).toContain('# Fix Test/Build Failures');
      expect(result).toContain('## Your Task');
      expect(result).toContain('Analyze the errors');
    });

    it('includes guidelines section', async () => {
      const result = await promptBuilder.assembleFixPrompt('Some error');

      expect(result).toContain('## Guidelines');
      expect(result).toContain('Focus only on fixing the specific errors shown');
    });

    it('includes completion criteria', async () => {
      const result = await promptBuilder.assembleFixPrompt('Some error');

      expect(result).toContain('## Completion');
      expect(result).toContain('all tests should pass');
    });

    it('wraps error output in code block', async () => {
      const errorOutput = 'Test failed';
      const result = await promptBuilder.assembleFixPrompt(errorOutput);

      expect(result).toMatch(/```\nTest failed\n```/);
    });

    it('handles multi-line error output', async () => {
      const errorOutput = 'Error 1\nError 2\nError 3';
      const result = await promptBuilder.assembleFixPrompt(errorOutput);

      expect(result).toContain('Error 1');
      expect(result).toContain('Error 2');
      expect(result).toContain('Error 3');
    });

    it('handles empty error output', async () => {
      const result = await promptBuilder.assembleFixPrompt('');

      expect(result).toContain('# Fix Test/Build Failures');
    });
  });

  describe('assembleReviewPrompt', () => {
    const mockIssue: Issue = {
      number: 42,
      title: 'Add user authentication',
      body: 'Implement JWT auth',
      state: 'open',
      labels: [{ name: 'backend' }],
      assignees: [],
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    };

    beforeEach(() => {
      vi.mocked(mockGitHub.viewIssue).mockResolvedValue(mockIssue);
      vi.mocked(mockGit.currentBranch).mockResolvedValue('issue-42-add-user-authentication');
      vi.mocked(mockGit.diffLinesVsMaster).mockResolvedValue(60);
      vi.mocked(mockGit.changedFilesCountVsMaster).mockResolvedValue(2);
      vi.mocked(mockTemplateEngine.render).mockReturnValue('Rendered review prompt');
    });

    it('fetches issue data from GitHub', async () => {
      await promptBuilder.assembleReviewPrompt(42);

      expect(mockGitHub.viewIssue).toHaveBeenCalledWith(42);
    });

    it('fetches current branch from Git', async () => {
      await promptBuilder.assembleReviewPrompt(42);

      expect(mockGit.currentBranch).toHaveBeenCalled();
    });

    it('fetches diff lines count from Git', async () => {
      await promptBuilder.assembleReviewPrompt(42);

      expect(mockGit.diffLinesVsMaster).toHaveBeenCalled();
    });

    it('fetches changed files count from Git', async () => {
      await promptBuilder.assembleReviewPrompt(42);

      expect(mockGit.changedFilesCountVsMaster).toHaveBeenCalled();
    });

    it('calculates small review size and single lens', async () => {
      vi.mocked(mockGit.diffLinesVsMaster).mockResolvedValue(30);
      vi.mocked(mockGit.changedFilesCountVsMaster).mockResolvedValue(1);

      await promptBuilder.assembleReviewPrompt(42);

      expect(mockTemplateEngine.render).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          review_size: 'small',
          lenses: 'Skeptic',
        })
      );
    });

    it('calculates medium review size and two lenses', async () => {
      vi.mocked(mockGit.diffLinesVsMaster).mockResolvedValue(100);
      vi.mocked(mockGit.changedFilesCountVsMaster).mockResolvedValue(4);

      await promptBuilder.assembleReviewPrompt(42);

      expect(mockTemplateEngine.render).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          review_size: 'medium',
          lenses: 'Skeptic, Architect',
        })
      );
    });

    it('calculates large review size and three lenses', async () => {
      vi.mocked(mockGit.diffLinesVsMaster).mockResolvedValue(500);
      vi.mocked(mockGit.changedFilesCountVsMaster).mockResolvedValue(10);

      await promptBuilder.assembleReviewPrompt(42);

      expect(mockTemplateEngine.render).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          review_size: 'large',
          lenses: 'Skeptic, Architect, Minimalist',
        })
      );
    });

    it('renders template with all required variables', async () => {
      await promptBuilder.assembleReviewPrompt(42);

      expect(mockTemplateEngine.render).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          issue_number: 42,
          issue_title: 'Add user authentication',
          branch: 'issue-42-add-user-authentication',
          intent: 'Implement: Add user authentication',
          lenses: expect.any(String),
          review_size: expect.any(String),
          default_branch: 'master',
          review_file_path: expect.stringContaining('.rig-reviews/issue-42/'),
        })
      );
    });

    it('uses custom default branch when provided', async () => {
      await promptBuilder.assembleReviewPrompt(42, { defaultBranch: 'main' });

      expect(mockTemplateEngine.render).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          default_branch: 'main',
        })
      );
    });

    it('uses custom review file path when provided', async () => {
      await promptBuilder.assembleReviewPrompt(42, {
        reviewFilePath: '.custom/review.md',
      });

      expect(mockTemplateEngine.render).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          review_file_path: '.custom/review.md',
        })
      );
    });

    it('reads review-prompt.md template', async () => {
      await promptBuilder.assembleReviewPrompt(42);

      const renderCall = vi.mocked(mockTemplateEngine.render).mock.calls[0];
      const template = renderCall[0];
      expect(template).toContain('# Adversarial Code Review');
    });

    it('returns rendered prompt string', async () => {
      const result = await promptBuilder.assembleReviewPrompt(42);

      expect(result).toBe('Rendered review prompt');
    });
  });
});
