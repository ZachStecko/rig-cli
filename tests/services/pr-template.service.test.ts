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
    it('generates PR body with all sections for backend component', async () => {
      const issueData = {
        number: 42,
        title: 'Add user authentication',
        body: 'This implements user auth.\n\n### Acceptance Criteria\n- Users can log in\n- Sessions persist',
        labels: [{ name: 'backend' }],
      };

      vi.mocked(mockGitHub.viewIssue).mockResolvedValue(issueData as any);
      vi.mocked(mockGit.logVsMaster).mockResolvedValue('abc123 Initial commit\ndef456 Add tests');
      vi.mocked(mockGit.diffStatVsMaster).mockResolvedValue('2 files changed, 50 insertions(+), 10 deletions(-)');
      vi.mocked(mockTestRunner.runBackendTests).mockResolvedValue({
        success: true,
        output: 'PASS\nok    github.com/test/backend    0.123s',
      });
      vi.mocked(mockTestRunner.listNewTestFiles).mockResolvedValue(['backend/auth_test.go']);
      vi.mocked(mockTemplateEngine.render).mockReturnValue('rendered PR body');

      const result = await service.generatePrBody(42, 'backend');

      expect(result).toBe('rendered PR body');
      expect(mockGitHub.viewIssue).toHaveBeenCalledWith(42);
      expect(mockGit.logVsMaster).toHaveBeenCalled();
      expect(mockGit.diffStatVsMaster).toHaveBeenCalled();
      expect(mockTestRunner.runBackendTests).toHaveBeenCalled();
      expect(mockTestRunner.listNewTestFiles).toHaveBeenCalled();

      // Verify template variables
      const renderCall = vi.mocked(mockTemplateEngine.render).mock.calls[0];
      const vars = renderCall[1];

      expect(vars.issue_number).toBe(42);
      expect(vars.issue_summary).toContain('This implements user auth');
      expect(vars.issue_context).toContain('### Acceptance Criteria');
      expect(vars.issue_context).toContain('Users can log in');
      expect(vars.commit_log).toBe('- abc123 Initial commit\n- def456 Add tests');
      expect(vars.diff_stat).toBe('2 files changed, 50 insertions(+), 10 deletions(-)');
      expect(vars.test_instructions).toContain('cd backend && go test');
      expect(vars.test_output).toContain('PASS');
      expect(vars.new_tests).toBe('- backend/auth_test.go');
      expect(vars.demo).toBe('_No demo recorded_');
      expect(vars.manual_test_steps).toContain('Manual testing steps');
    });

    it('generates PR body for frontend component', async () => {
      const issueData = {
        number: 43,
        title: 'Add login form',
        body: 'Login form component',
        labels: [{ name: 'frontend' }],
      };

      vi.mocked(mockGitHub.viewIssue).mockResolvedValue(issueData as any);
      vi.mocked(mockGit.logVsMaster).mockResolvedValue('abc123 Add form');
      vi.mocked(mockGit.diffStatVsMaster).mockResolvedValue('1 file changed');
      vi.mocked(mockTestRunner.runFrontendTests).mockResolvedValue({
        success: true,
        output: '✓ Login.test.tsx (2)\nTest Files  1 passed (1)',
      });
      vi.mocked(mockTestRunner.listNewTestFiles).mockResolvedValue([]);
      vi.mocked(mockTemplateEngine.render).mockReturnValue('rendered');

      await service.generatePrBody(43, 'frontend');

      const vars = vi.mocked(mockTemplateEngine.render).mock.calls[0][1];
      expect(vars.test_instructions).toContain('cd frontend && npm test');
      expect(vars.test_instructions).toContain('npm run lint');
      expect(vars.test_instructions).toContain('npm run build');
      expect(vars.new_tests).toBe('_None_');
    });

    it('generates PR body for devnet component', async () => {
      const issueData = {
        number: 44,
        title: 'Add devnet config',
        body: 'Config for devnet',
        labels: [{ name: 'devnet' }],
      };

      vi.mocked(mockGitHub.viewIssue).mockResolvedValue(issueData as any);
      vi.mocked(mockGit.logVsMaster).mockResolvedValue('abc123 Config');
      vi.mocked(mockGit.diffStatVsMaster).mockResolvedValue('1 file changed');
      vi.mocked(mockTestRunner.runDevnetTests).mockResolvedValue({
        success: true,
        output: 'Test Files  1 passed (1)',
      });
      vi.mocked(mockTestRunner.listNewTestFiles).mockResolvedValue([]);
      vi.mocked(mockTemplateEngine.render).mockReturnValue('rendered');

      await service.generatePrBody(44, 'devnet');

      const vars = vi.mocked(mockTemplateEngine.render).mock.calls[0][1];
      expect(vars.test_instructions).toContain('cd devnet && npx vitest run');
    });

    it('generates PR body for fullstack component', async () => {
      const issueData = {
        number: 45,
        title: 'Fullstack feature',
        body: 'Full feature',
        labels: [{ name: 'fullstack' }],
      };

      vi.mocked(mockGitHub.viewIssue).mockResolvedValue(issueData as any);
      vi.mocked(mockGit.logVsMaster).mockResolvedValue('abc123 Feature');
      vi.mocked(mockGit.diffStatVsMaster).mockResolvedValue('5 files changed');
      vi.mocked(mockTestRunner.runAllTests).mockResolvedValue({
        success: true,
        output: 'All tests passed',
      });
      vi.mocked(mockTestRunner.listNewTestFiles).mockResolvedValue([]);
      vi.mocked(mockTemplateEngine.render).mockReturnValue('rendered');

      await service.generatePrBody(45, 'fullstack');

      const vars = vi.mocked(mockTemplateEngine.render).mock.calls[0][1];
      expect(vars.test_instructions).toContain('# Backend');
      expect(vars.test_instructions).toContain('# Frontend');
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
      vi.mocked(mockGit.diffStatVsMaster).mockResolvedValue('');
      vi.mocked(mockTestRunner.runBackendTests).mockResolvedValue({
        success: true,
        output: '',
      });
      vi.mocked(mockTestRunner.listNewTestFiles).mockResolvedValue([]);
      vi.mocked(mockTemplateEngine.render).mockReturnValue('rendered');

      await service.generatePrBody(46, 'backend');

      const vars = vi.mocked(mockTemplateEngine.render).mock.calls[0][1];
      expect(vars.commit_log).toBe('- No commits');
      expect(vars.diff_stat).toBe('No changes');
    });

    it('handles test failures', async () => {
      const issueData = {
        number: 47,
        title: 'Test',
        body: 'Test',
        labels: [],
      };

      vi.mocked(mockGitHub.viewIssue).mockResolvedValue(issueData as any);
      vi.mocked(mockGit.logVsMaster).mockResolvedValue('abc123 Commit');
      vi.mocked(mockGit.diffStatVsMaster).mockResolvedValue('1 file changed');
      vi.mocked(mockTestRunner.runBackendTests).mockRejectedValue(new Error('Tests failed'));
      vi.mocked(mockTestRunner.listNewTestFiles).mockResolvedValue([]);
      vi.mocked(mockTemplateEngine.render).mockReturnValue('rendered');

      await service.generatePrBody(47, 'backend');

      const vars = vi.mocked(mockTemplateEngine.render).mock.calls[0][1];
      expect(vars.test_output).toBe('Tests not run');
    });

    it('handles skipped tests', async () => {
      const issueData = {
        number: 48,
        title: 'Test',
        body: 'Test',
        labels: [],
      };

      vi.mocked(mockGitHub.viewIssue).mockResolvedValue(issueData as any);
      vi.mocked(mockGit.logVsMaster).mockResolvedValue('abc123 Commit');
      vi.mocked(mockGit.diffStatVsMaster).mockResolvedValue('1 file changed');
      vi.mocked(mockTestRunner.runBackendTests).mockResolvedValue({
        success: true,
        output: '',
        skipped: true,
      });
      vi.mocked(mockTestRunner.listNewTestFiles).mockResolvedValue([]);
      vi.mocked(mockTemplateEngine.render).mockReturnValue('rendered');

      await service.generatePrBody(48, 'backend');

      const vars = vi.mocked(mockTemplateEngine.render).mock.calls[0][1];
      expect(vars.test_output).toBe('Tests not run (component directory not found)');
    });

    it('extracts summary lines from test output (matches at end)', async () => {
      const issueData = {
        number: 49,
        title: 'Test',
        body: 'Test',
        labels: [],
      };

      const testOutput = `
Starting tests...
Running tests...
More output...
Even more...
And more...
And more...
And more...
And more...
And more...
✓ Test Files  5 passed (5)
✓ Tests  25 passed (25)
PASS backend
ok    github.com/test/backend    0.234s
`;

      vi.mocked(mockGitHub.viewIssue).mockResolvedValue(issueData as any);
      vi.mocked(mockGit.logVsMaster).mockResolvedValue('abc123 Commit');
      vi.mocked(mockGit.diffStatVsMaster).mockResolvedValue('1 file changed');
      vi.mocked(mockTestRunner.runBackendTests).mockResolvedValue({
        success: true,
        output: testOutput,
      });
      vi.mocked(mockTestRunner.listNewTestFiles).mockResolvedValue([]);
      vi.mocked(mockTemplateEngine.render).mockReturnValue('rendered');

      await service.generatePrBody(49, 'backend');

      const vars = vi.mocked(mockTemplateEngine.render).mock.calls[0][1];
      expect(vars.test_output).toContain('✓ Test Files');
      expect(vars.test_output).toContain('PASS');
      expect(vars.test_output).not.toContain('Starting tests');
    });

    it('extracts summary lines from test output (matches at beginning)', async () => {
      const issueData = {
        number: 50,
        title: 'Test',
        body: 'Test',
        labels: [],
      };

      // Simulate output where matching lines are at the beginning
      // followed by many non-matching lines
      const matchingLines = Array.from({ length: 20 }, (_, i) =>
        `✓ Test suite ${i + 1} passed`
      ).join('\n');

      const nonMatchingLines = Array.from({ length: 50 }, (_, i) =>
        `Non-matching output line ${i + 1}`
      ).join('\n');

      const testOutput = matchingLines + '\n' + nonMatchingLines;

      vi.mocked(mockGitHub.viewIssue).mockResolvedValue(issueData as any);
      vi.mocked(mockGit.logVsMaster).mockResolvedValue('abc123 Commit');
      vi.mocked(mockGit.diffStatVsMaster).mockResolvedValue('1 file changed');
      vi.mocked(mockTestRunner.runBackendTests).mockResolvedValue({
        success: true,
        output: testOutput,
      });
      vi.mocked(mockTestRunner.listNewTestFiles).mockResolvedValue([]);
      vi.mocked(mockTemplateEngine.render).mockReturnValue('rendered');

      await service.generatePrBody(50, 'backend');

      const vars = vi.mocked(mockTemplateEngine.render).mock.calls[0][1];

      // Should show last 10 MATCHING lines (suite 11-20), not last 10 overall lines
      expect(vars.test_output).toContain('Test suite 20 passed');
      expect(vars.test_output).toContain('Test suite 11 passed');
      expect(vars.test_output).not.toContain('Test suite 10 passed');
      expect(vars.test_output).not.toContain('Non-matching output');
    });

    it('includes demo when demo files exist', async () => {
      const issueData = {
        number: 51,
        title: 'Test',
        body: 'Test',
        labels: [],
      };

      vi.mocked(mockGitHub.viewIssue).mockResolvedValue(issueData as any);
      vi.mocked(mockGit.logVsMaster).mockResolvedValue('abc123 Commit');
      vi.mocked(mockGit.diffStatVsMaster).mockResolvedValue('1 file changed');
      vi.mocked(mockTestRunner.runBackendTests).mockResolvedValue({
        success: true,
        output: 'PASS',
      });
      vi.mocked(mockTestRunner.listNewTestFiles).mockResolvedValue([]);
      vi.mocked(mockTemplateEngine.render).mockReturnValue('rendered');

      // Mock demo directory exists
      vi.mocked(existsSync).mockImplementation((path: any) => {
        return path.includes('.rig-reviews/issue-51');
      });

      // Mock readdirSync
      vi.mocked(readdirSync).mockReturnValue(['demo-2026-03-09.gif', 'other.txt'] as any);

      await service.generatePrBody(51, 'backend');

      const vars = vi.mocked(mockTemplateEngine.render).mock.calls[0][1];
      expect(vars.demo).toContain('![Demo](demo-2026-03-09.gif)');
    });

    it('shows demo artifacts message when demo dir exists but no gifs', async () => {
      const issueData = {
        number: 52,
        title: 'Test',
        body: 'Test',
        labels: [],
      };

      vi.mocked(mockGitHub.viewIssue).mockResolvedValue(issueData as any);
      vi.mocked(mockGit.logVsMaster).mockResolvedValue('abc123 Commit');
      vi.mocked(mockGit.diffStatVsMaster).mockResolvedValue('1 file changed');
      vi.mocked(mockTestRunner.runBackendTests).mockResolvedValue({
        success: true,
        output: 'PASS',
      });
      vi.mocked(mockTestRunner.listNewTestFiles).mockResolvedValue([]);
      vi.mocked(mockTemplateEngine.render).mockReturnValue('rendered');

      // Mock demo directory exists
      vi.mocked(existsSync).mockImplementation((path: any) => {
        return path.includes('.rig-reviews/issue-52');
      });

      // Mock readdirSync with no gif files
      vi.mocked(readdirSync).mockReturnValue(['other.txt', 'readme.md'] as any);

      await service.generatePrBody(52, 'backend');

      const vars = vi.mocked(mockTemplateEngine.render).mock.calls[0][1];
      expect(vars.demo).toContain('Demo artifacts available');
      expect(vars.demo).toContain('.rig-reviews/issue-52');
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

  describe('buildTestInstructions', () => {
    it('returns backend instructions', async () => {
      const issueData = {
        number: 20,
        title: 'Test',
        body: 'Test',
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

      await service.generatePrBody(20, 'backend');

      const vars = vi.mocked(mockTemplateEngine.render).mock.calls[0][1];
      expect(vars.test_instructions).toContain('cd backend && go test ./... -v');
    });

    it('returns frontend instructions', async () => {
      const issueData = {
        number: 21,
        title: 'Test',
        body: 'Test',
        labels: [],
      };

      vi.mocked(mockGitHub.viewIssue).mockResolvedValue(issueData as any);
      vi.mocked(mockGit.logVsMaster).mockResolvedValue('commit');
      vi.mocked(mockGit.diffStatVsMaster).mockResolvedValue('diff');
      vi.mocked(mockTestRunner.runFrontendTests).mockResolvedValue({
        success: true,
        output: 'pass',
      });
      vi.mocked(mockTestRunner.listNewTestFiles).mockResolvedValue([]);
      vi.mocked(mockTemplateEngine.render).mockReturnValue('rendered');

      await service.generatePrBody(21, 'frontend');

      const vars = vi.mocked(mockTemplateEngine.render).mock.calls[0][1];
      expect(vars.test_instructions).toContain('cd frontend && npm test');
      expect(vars.test_instructions).toContain('cd frontend && npm run lint');
      expect(vars.test_instructions).toContain('cd frontend && npm run build');
    });

    it('returns devnet instructions', async () => {
      const issueData = {
        number: 22,
        title: 'Test',
        body: 'Test',
        labels: [],
      };

      vi.mocked(mockGitHub.viewIssue).mockResolvedValue(issueData as any);
      vi.mocked(mockGit.logVsMaster).mockResolvedValue('commit');
      vi.mocked(mockGit.diffStatVsMaster).mockResolvedValue('diff');
      vi.mocked(mockTestRunner.runDevnetTests).mockResolvedValue({
        success: true,
        output: 'pass',
      });
      vi.mocked(mockTestRunner.listNewTestFiles).mockResolvedValue([]);
      vi.mocked(mockTemplateEngine.render).mockReturnValue('rendered');

      await service.generatePrBody(22, 'devnet');

      const vars = vi.mocked(mockTemplateEngine.render).mock.calls[0][1];
      expect(vars.test_instructions).toContain('cd devnet && npx vitest run');
    });

    it('returns fullstack instructions', async () => {
      const issueData = {
        number: 23,
        title: 'Test',
        body: 'Test',
        labels: [],
      };

      vi.mocked(mockGitHub.viewIssue).mockResolvedValue(issueData as any);
      vi.mocked(mockGit.logVsMaster).mockResolvedValue('commit');
      vi.mocked(mockGit.diffStatVsMaster).mockResolvedValue('diff');
      vi.mocked(mockTestRunner.runAllTests).mockResolvedValue({
        success: true,
        output: 'pass',
      });
      vi.mocked(mockTestRunner.listNewTestFiles).mockResolvedValue([]);
      vi.mocked(mockTemplateEngine.render).mockReturnValue('rendered');

      await service.generatePrBody(23, 'fullstack');

      const vars = vi.mocked(mockTemplateEngine.render).mock.calls[0][1];
      expect(vars.test_instructions).toContain('# Backend');
      expect(vars.test_instructions).toContain('cd backend && go test ./... -v');
      expect(vars.test_instructions).toContain('# Frontend');
      expect(vars.test_instructions).toContain('cd frontend && npm test');
    });
  });
});
