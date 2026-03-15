import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrTemplateService } from '../../src/services/pr-template.service.js';
import { GitHubService } from '../../src/services/github.service.js';
import { GitService } from '../../src/services/git.service.js';
import { TemplateEngine } from '../../src/services/template-engine.service.js';
import { TestRunnerService } from '../../src/services/test-runner.service.js';
import { readFile } from 'fs/promises';
import { existsSync, readdirSync } from 'fs';

vi.mock('fs/promises');
vi.mock('fs');

describe('PrTemplateService', () => {
  let service: PrTemplateService;
  let mockGitHub: GitHubService;
  let mockGit: GitService;
  let mockTemplateEngine: TemplateEngine;
  let mockTestRunner: TestRunnerService;
  const projectRoot = '/test/project';

  beforeEach(() => {
    vi.clearAllMocks();

    mockGitHub = {
      viewIssue: vi.fn(),
    } as any;

    mockGit = {
      logVsMaster: vi.fn(),
      diffStatVsMaster: vi.fn(),
      newFilesVsMaster: vi.fn(),
    } as any;

    mockTemplateEngine = {
      render: vi.fn(),
    } as any;

    mockTestRunner = {
      runBackendTests: vi.fn(),
      runFrontendTests: vi.fn(),
      runDevnetTests: vi.fn(),
      runAllTests: vi.fn(),
      listNewTestFiles: vi.fn(),
    } as any;

    service = new PrTemplateService(
      mockGitHub,
      mockGit,
      mockTemplateEngine,
      mockTestRunner,
      projectRoot
    );

    vi.mocked(readFile).mockResolvedValue('template content');
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readdirSync).mockReturnValue([] as any);
  });

  describe('generatePrBody', () => {
    it('generates PR body with all sections', async () => {
      const issueData = {
        number: 42,
        title: 'Add user authentication',
        body: 'This implements user auth.\n\n### Acceptance Criteria\n- Users can log in\n- Sessions persist',
        labels: [{ name: 'backend' }],
      };

      vi.mocked(mockGitHub.viewIssue).mockResolvedValue(issueData as any);
      vi.mocked(mockGit.logVsMaster).mockResolvedValue('abc123 Initial commit\ndef456 Add tests');
      vi.mocked(mockTemplateEngine.render).mockReturnValue('rendered PR body');

      const result = await service.generatePrBody(42, 'backend');

      expect(result).toBe('rendered PR body');
      expect(mockGitHub.viewIssue).toHaveBeenCalledWith(42);
      expect(mockGit.logVsMaster).toHaveBeenCalled();

      // Verify template variables
      const renderCall = vi.mocked(mockTemplateEngine.render).mock.calls[0];
      const vars = renderCall[1];

      expect(vars.issue_number).toBe(42);
      expect(vars.issue_summary).toContain('This implements user auth');
      expect(vars.issue_context).toContain('### Acceptance Criteria');
      expect(vars.issue_context).toContain('Users can log in');
      expect(vars.commit_log).toBe('- abc123 Initial commit\n- def456 Add tests');
      expect(vars.manual_test_steps).toBeDefined();
    });

    it('handles empty commit log', async () => {
      const issueData = {
        number: 46,
        title: 'Test',
        body: 'Test',
        labels: [],
      };

      vi.mocked(mockGitHub.viewIssue).mockResolvedValue(issueData as any);
      vi.mocked(mockGit.logVsMaster).mockResolvedValue('');
      vi.mocked(mockTemplateEngine.render).mockReturnValue('rendered');

      await service.generatePrBody(46, 'backend');

      const vars = vi.mocked(mockTemplateEngine.render).mock.calls[0][1];
      expect(vars.commit_log).toBe('- No commits');
    });
  });

  describe('extractSummary', () => {
    it('returns title when body is empty', async () => {
      const issueData = {
        number: 1,
        title: 'Test Title',
        body: '',
        labels: [],
      };

      vi.mocked(mockGitHub.viewIssue).mockResolvedValue(issueData as any);
      vi.mocked(mockGit.logVsMaster).mockResolvedValue('commit');
      vi.mocked(mockGit.diffStatVsMaster).mockResolvedValue('diff');
      vi.mocked(mockTestRunner.runBackendTests).mockResolvedValue({
        success: true,
        output: 'pass',
      });
      vi.mocked(mockTestRunner.listNewTestFiles).mockResolvedValue([]);
      vi.mocked(mockTemplateEngine.render).mockReturnValue('rendered');

      await service.generatePrBody(1, 'backend');

      const vars = vi.mocked(mockTemplateEngine.render).mock.calls[0][1];
      expect(vars.issue_summary).toBe('Test Title');
    });

    it('extracts first paragraph from body', async () => {
      const issueData = {
        number: 2,
        title: 'Test Title',
        body: 'First paragraph line 1\nFirst paragraph line 2\n\nSecond paragraph',
        labels: [],
      };

      vi.mocked(mockGitHub.viewIssue).mockResolvedValue(issueData as any);
      vi.mocked(mockGit.logVsMaster).mockResolvedValue('commit');
      vi.mocked(mockGit.diffStatVsMaster).mockResolvedValue('diff');
      vi.mocked(mockTestRunner.runBackendTests).mockResolvedValue({
        success: true,
        output: 'pass',
      });
      vi.mocked(mockTestRunner.listNewTestFiles).mockResolvedValue([]);
      vi.mocked(mockTemplateEngine.render).mockReturnValue('rendered');

      await service.generatePrBody(2, 'backend');

      const vars = vi.mocked(mockTemplateEngine.render).mock.calls[0][1];
      expect(vars.issue_summary).toBe('First paragraph line 1\nFirst paragraph line 2');
      expect(vars.issue_summary).not.toContain('Second paragraph');
    });

    it('limits summary to first 5 lines', async () => {
      const issueData = {
        number: 3,
        title: 'Test Title',
        body: 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7',
        labels: [],
      };

      vi.mocked(mockGitHub.viewIssue).mockResolvedValue(issueData as any);
      vi.mocked(mockGit.logVsMaster).mockResolvedValue('commit');
      vi.mocked(mockGit.diffStatVsMaster).mockResolvedValue('diff');
      vi.mocked(mockTestRunner.runBackendTests).mockResolvedValue({
        success: true,
        output: 'pass',
      });
      vi.mocked(mockTestRunner.listNewTestFiles).mockResolvedValue([]);
      vi.mocked(mockTemplateEngine.render).mockReturnValue('rendered');

      await service.generatePrBody(3, 'backend');

      const vars = vi.mocked(mockTemplateEngine.render).mock.calls[0][1];
      expect(vars.issue_summary).toBe('Line 1\nLine 2\nLine 3\nLine 4\nLine 5');
      expect(vars.issue_summary).not.toContain('Line 6');
    });
  });

  describe('extractContext', () => {
    it('returns fallback when body is empty', async () => {
      const issueData = {
        number: 10,
        title: 'Test',
        body: '',
        labels: [],
      };

      vi.mocked(mockGitHub.viewIssue).mockResolvedValue(issueData as any);
      vi.mocked(mockGit.logVsMaster).mockResolvedValue('commit');
      vi.mocked(mockGit.diffStatVsMaster).mockResolvedValue('diff');
      vi.mocked(mockTestRunner.runBackendTests).mockResolvedValue({
        success: true,
        output: 'pass',
      });
      vi.mocked(mockTestRunner.listNewTestFiles).mockResolvedValue([]);
      vi.mocked(mockTemplateEngine.render).mockReturnValue('rendered');

      await service.generatePrBody(10, 'backend');

      const vars = vi.mocked(mockTemplateEngine.render).mock.calls[0][1];
      expect(vars.issue_context).toBe('See issue #10 for full details.');
    });

    it('extracts Acceptance Criteria section', async () => {
      const issueData = {
        number: 11,
        title: 'Test',
        body: `Description here

### Acceptance Criteria
- Users can login
- Sessions persist
- Errors handled

### Implementation
Some implementation notes`,
        labels: [],
      };

      vi.mocked(mockGitHub.viewIssue).mockResolvedValue(issueData as any);
      vi.mocked(mockGit.logVsMaster).mockResolvedValue('commit');
      vi.mocked(mockGit.diffStatVsMaster).mockResolvedValue('diff');
      vi.mocked(mockTestRunner.runBackendTests).mockResolvedValue({
        success: true,
        output: 'pass',
      });
      vi.mocked(mockTestRunner.listNewTestFiles).mockResolvedValue([]);
      vi.mocked(mockTemplateEngine.render).mockReturnValue('rendered');

      await service.generatePrBody(11, 'backend');

      const vars = vi.mocked(mockTemplateEngine.render).mock.calls[0][1];
      expect(vars.issue_context).toContain('### Acceptance Criteria');
      expect(vars.issue_context).toContain('Users can login');
      expect(vars.issue_context).toContain('Sessions persist');
      expect(vars.issue_context).not.toContain('Implementation');
    });

    it('extracts Implementation section if no Acceptance Criteria', async () => {
      const issueData = {
        number: 12,
        title: 'Test',
        body: `Description here

### Implementation
Step 1: Do this
Step 2: Do that`,
        labels: [],
      };

      vi.mocked(mockGitHub.viewIssue).mockResolvedValue(issueData as any);
      vi.mocked(mockGit.logVsMaster).mockResolvedValue('commit');
      vi.mocked(mockGit.diffStatVsMaster).mockResolvedValue('diff');
      vi.mocked(mockTestRunner.runBackendTests).mockResolvedValue({
        success: true,
        output: 'pass',
      });
      vi.mocked(mockTestRunner.listNewTestFiles).mockResolvedValue([]);
      vi.mocked(mockTemplateEngine.render).mockReturnValue('rendered');

      await service.generatePrBody(12, 'backend');

      const vars = vi.mocked(mockTemplateEngine.render).mock.calls[0][1];
      expect(vars.issue_context).toContain('### Implementation');
      expect(vars.issue_context).toContain('Step 1: Do this');
      expect(vars.issue_context).toContain('Step 2: Do that');
    });

    it('limits context to 15 lines', async () => {
      const longContext = Array.from({ length: 20 }, (_, i) => `- Criterion ${i + 1}`).join('\n');
      const issueData = {
        number: 13,
        title: 'Test',
        body: `### Acceptance Criteria\n${longContext}`,
        labels: [],
      };

      vi.mocked(mockGitHub.viewIssue).mockResolvedValue(issueData as any);
      vi.mocked(mockGit.logVsMaster).mockResolvedValue('commit');
      vi.mocked(mockGit.diffStatVsMaster).mockResolvedValue('diff');
      vi.mocked(mockTestRunner.runBackendTests).mockResolvedValue({
        success: true,
        output: 'pass',
      });
      vi.mocked(mockTestRunner.listNewTestFiles).mockResolvedValue([]);
      vi.mocked(mockTemplateEngine.render).mockReturnValue('rendered');

      await service.generatePrBody(13, 'backend');

      const vars = vi.mocked(mockTemplateEngine.render).mock.calls[0][1];
      const lines = vars.issue_context.split('\n');
      expect(lines.length).toBeLessThanOrEqual(15);
      expect(vars.issue_context).toContain('### Acceptance Criteria');
      expect(vars.issue_context).toContain('Criterion 1');
      expect(vars.issue_context).toContain('Criterion 14'); // Only 14 criteria lines fit (heading takes 1 line)
      expect(vars.issue_context).not.toContain('Criterion 15');
    });

    it('returns fallback if no Acceptance Criteria or Implementation', async () => {
      const issueData = {
        number: 14,
        title: 'Test',
        body: `### Description\nSome description\n\n### Notes\nSome notes`,
        labels: [],
      };

      vi.mocked(mockGitHub.viewIssue).mockResolvedValue(issueData as any);
      vi.mocked(mockGit.logVsMaster).mockResolvedValue('commit');
      vi.mocked(mockGit.diffStatVsMaster).mockResolvedValue('diff');
      vi.mocked(mockTestRunner.runBackendTests).mockResolvedValue({
        success: true,
        output: 'pass',
      });
      vi.mocked(mockTestRunner.listNewTestFiles).mockResolvedValue([]);
      vi.mocked(mockTemplateEngine.render).mockReturnValue('rendered');

      await service.generatePrBody(14, 'backend');

      const vars = vi.mocked(mockTemplateEngine.render).mock.calls[0][1];
      expect(vars.issue_context).toBe('See issue #14 for full details.');
    });
  });

});
