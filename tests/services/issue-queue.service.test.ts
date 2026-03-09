import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IssueQueueService } from '../../src/services/issue-queue.service.js';
import { GitHubService } from '../../src/services/github.service.js';
import { Issue } from '../../src/types/issue.types.js';

describe('IssueQueueService', () => {
  let issueQueueService: IssueQueueService;
  let mockGithub: GitHubService;

  beforeEach(() => {
    mockGithub = {
      listIssues: vi.fn(),
      hasOpenPr: vi.fn(),
    } as any;

    issueQueueService = new IssueQueueService(mockGithub);
  });

  describe('fetch', () => {
    it('fetches and scores issues', async () => {
      const mockIssues: Issue[] = [
        {
          number: 100,
          title: 'Issue 100',
          labels: [{ name: 'Phase 1: MVP' }, { name: 'p0' }],
        },
        {
          number: 200,
          title: 'Issue 200',
          labels: [{ name: 'Phase 1: MVP' }, { name: 'p1' }],
        },
      ];

      vi.mocked(mockGithub.listIssues).mockResolvedValue(mockIssues);

      const result = await issueQueueService.fetch();

      expect(result).toHaveLength(2);
      expect(result[0].number).toBe(100);
      expect(result[0].score).toBe(992900); // 99*10000 + 3*1000 - 100
      expect(result[1].number).toBe(200);
      expect(result[1].score).toBe(991800); // 99*10000 + 2*1000 - 200
    });

    it('sorts issues by score descending', async () => {
      const mockIssues: Issue[] = [
        {
          number: 300,
          title: 'Low priority',
          labels: [{ name: 'Phase 2: Beta' }, { name: 'p2' }],
        },
        {
          number: 100,
          title: 'High priority',
          labels: [{ name: 'Phase 1: MVP' }, { name: 'p0' }],
        },
        {
          number: 200,
          title: 'Medium priority',
          labels: [{ name: 'Phase 1: MVP' }, { name: 'p1' }],
        },
      ];

      vi.mocked(mockGithub.listIssues).mockResolvedValue(mockIssues);

      const result = await issueQueueService.fetch();

      // Sorted by score: Phase 1 p0 (#100), Phase 1 p1 (#200), Phase 2 p2 (#300)
      expect(result[0].number).toBe(100); // 992100
      expect(result[1].number).toBe(200); // 992200
      expect(result[2].number).toBe(300); // 981300
    });

    it('filters out epics', async () => {
      const mockIssues: Issue[] = [
        {
          number: 100,
          title: 'Regular issue',
          labels: [{ name: 'bug' }],
        },
        {
          number: 200,
          title: 'Epic issue',
          labels: [{ name: 'epic' }],
        },
        {
          number: 300,
          title: 'Another epic',
          labels: [{ name: 'Epic' }],
        },
      ];

      vi.mocked(mockGithub.listIssues).mockResolvedValue(mockIssues);

      const result = await issueQueueService.fetch();

      expect(result).toHaveLength(1);
      expect(result[0].number).toBe(100);
    });

    it('filters by phase', async () => {
      const mockIssues: Issue[] = [
        {
          number: 100,
          title: 'Phase 1 issue',
          labels: [{ name: 'Phase 1: MVP' }],
        },
        {
          number: 200,
          title: 'Phase 2 issue',
          labels: [{ name: 'Phase 2: Beta' }],
        },
        {
          number: 300,
          title: 'No phase',
          labels: [{ name: 'bug' }],
        },
      ];

      vi.mocked(mockGithub.listIssues).mockResolvedValue(mockIssues);

      const result = await issueQueueService.fetch({ phase: 'Phase 1: MVP' });

      expect(result).toHaveLength(1);
      expect(result[0].number).toBe(100);
    });

    it('filters by component', async () => {
      const mockIssues: Issue[] = [
        {
          number: 100,
          title: 'Backend issue',
          labels: [{ name: 'backend' }],
        },
        {
          number: 200,
          title: 'Frontend issue',
          labels: [{ name: 'frontend' }],
        },
        {
          number: 300,
          title: 'Mixed case',
          labels: [{ name: 'Backend' }],
        },
      ];

      vi.mocked(mockGithub.listIssues).mockResolvedValue(mockIssues);

      const result = await issueQueueService.fetch({ component: 'backend' });

      // Should match case-insensitively
      expect(result).toHaveLength(2);
      expect(result.map(i => i.number).sort()).toEqual([100, 300]);
    });

    it('combines phase and component filters', async () => {
      const mockIssues: Issue[] = [
        {
          number: 100,
          title: 'Phase 1 backend',
          labels: [{ name: 'Phase 1: MVP' }, { name: 'backend' }],
        },
        {
          number: 200,
          title: 'Phase 1 frontend',
          labels: [{ name: 'Phase 1: MVP' }, { name: 'frontend' }],
        },
        {
          number: 300,
          title: 'Phase 2 backend',
          labels: [{ name: 'Phase 2: Beta' }, { name: 'backend' }],
        },
      ];

      vi.mocked(mockGithub.listIssues).mockResolvedValue(mockIssues);

      const result = await issueQueueService.fetch({
        phase: 'Phase 1: MVP',
        component: 'backend',
      });

      expect(result).toHaveLength(1);
      expect(result[0].number).toBe(100);
    });

    it('returns empty array when no issues', async () => {
      vi.mocked(mockGithub.listIssues).mockResolvedValue([]);

      const result = await issueQueueService.fetch();

      expect(result).toEqual([]);
    });

    it('returns empty array when all issues filtered out', async () => {
      const mockIssues: Issue[] = [
        {
          number: 100,
          title: 'Epic',
          labels: [{ name: 'epic' }],
        },
      ];

      vi.mocked(mockGithub.listIssues).mockResolvedValue(mockIssues);

      const result = await issueQueueService.fetch();

      expect(result).toEqual([]);
    });
  });

  describe('next', () => {
    it('returns first issue without open PR', async () => {
      const mockIssues: Issue[] = [
        {
          number: 100,
          title: 'Has PR',
          labels: [{ name: 'Phase 1: MVP' }, { name: 'p0' }],
        },
        {
          number: 200,
          title: 'No PR',
          labels: [{ name: 'Phase 1: MVP' }, { name: 'p0' }],
        },
        {
          number: 300,
          title: 'Also no PR',
          labels: [{ name: 'Phase 1: MVP' }, { name: 'p1' }],
        },
      ];

      vi.mocked(mockGithub.listIssues).mockResolvedValue(mockIssues);
      vi.mocked(mockGithub.hasOpenPr).mockResolvedValueOnce(true);  // #100 has PR
      vi.mocked(mockGithub.hasOpenPr).mockResolvedValueOnce(false); // #200 no PR

      const result = await issueQueueService.next();

      expect(result).not.toBeNull();
      expect(result!.number).toBe(200);
    });

    it('returns null when all issues have open PRs', async () => {
      const mockIssues: Issue[] = [
        {
          number: 100,
          title: 'Has PR',
          labels: [{ name: 'p0' }],
        },
        {
          number: 200,
          title: 'Also has PR',
          labels: [{ name: 'p0' }],
        },
      ];

      vi.mocked(mockGithub.listIssues).mockResolvedValue(mockIssues);
      vi.mocked(mockGithub.hasOpenPr).mockResolvedValue(true);

      const result = await issueQueueService.next();

      expect(result).toBeNull();
    });

    it('returns null when no issues', async () => {
      vi.mocked(mockGithub.listIssues).mockResolvedValue([]);

      const result = await issueQueueService.next();

      expect(result).toBeNull();
    });

    it('respects filters when finding next issue', async () => {
      const mockIssues: Issue[] = [
        {
          number: 100,
          title: 'Phase 1 backend',
          labels: [{ name: 'Phase 1: MVP' }, { name: 'backend' }],
        },
        {
          number: 200,
          title: 'Phase 1 frontend',
          labels: [{ name: 'Phase 1: MVP' }, { name: 'frontend' }],
        },
      ];

      vi.mocked(mockGithub.listIssues).mockResolvedValue(mockIssues);
      vi.mocked(mockGithub.hasOpenPr).mockResolvedValue(false);

      const result = await issueQueueService.next({
        phase: 'Phase 1: MVP',
        component: 'frontend',
      });

      expect(result).not.toBeNull();
      expect(result!.number).toBe(200);
    });
  });

  describe('scoring', () => {
    it('scores Phase 1 higher than Phase 2', async () => {
      const mockIssues: Issue[] = [
        {
          number: 100,
          title: 'Phase 2',
          labels: [{ name: 'Phase 2: Beta' }],
        },
        {
          number: 100,
          title: 'Phase 1',
          labels: [{ name: 'Phase 1: MVP' }],
        },
      ];

      vi.mocked(mockGithub.listIssues).mockResolvedValue(mockIssues);

      const result = await issueQueueService.fetch();

      // Phase 1 should score higher
      expect(result[0].labels).toContain('Phase 1: MVP');
      expect(result[0].score).toBeGreaterThan(result[1].score);
    });

    it('scores p0 higher than p1 higher than p2', async () => {
      const mockIssues: Issue[] = [
        {
          number: 100,
          title: 'p2',
          labels: [{ name: 'Phase 1: MVP' }, { name: 'p2' }],
        },
        {
          number: 100,
          title: 'p0',
          labels: [{ name: 'Phase 1: MVP' }, { name: 'p0' }],
        },
        {
          number: 100,
          title: 'p1',
          labels: [{ name: 'Phase 1: MVP' }, { name: 'p1' }],
        },
      ];

      vi.mocked(mockGithub.listIssues).mockResolvedValue(mockIssues);

      const result = await issueQueueService.fetch();

      expect(result[0].labels).toContain('p0');
      expect(result[1].labels).toContain('p1');
      expect(result[2].labels).toContain('p2');
    });

    it('scores lower issue numbers higher within same phase and priority', async () => {
      const mockIssues: Issue[] = [
        {
          number: 300,
          title: 'Higher number',
          labels: [{ name: 'Phase 1: MVP' }, { name: 'p0' }],
        },
        {
          number: 100,
          title: 'Lower number',
          labels: [{ name: 'Phase 1: MVP' }, { name: 'p0' }],
        },
      ];

      vi.mocked(mockGithub.listIssues).mockResolvedValue(mockIssues);

      const result = await issueQueueService.fetch();

      expect(result[0].number).toBe(100); // Lower number scores higher
      expect(result[1].number).toBe(300);
    });

    it('handles issues with no phase or priority', async () => {
      const mockIssues: Issue[] = [
        {
          number: 100,
          title: 'No labels',
          labels: [],
        },
        {
          number: 200,
          title: 'With phase',
          labels: [{ name: 'Phase 1: MVP' }],
        },
      ];

      vi.mocked(mockGithub.listIssues).mockResolvedValue(mockIssues);

      const result = await issueQueueService.fetch();

      // Issue with phase should score higher
      expect(result[0].number).toBe(200);
      expect(result[1].number).toBe(100);
      expect(result[1].score).toBe(-100); // 0*10000 + 0*1000 - 100
    });

    it('handles malformed phase labels', async () => {
      const mockIssues: Issue[] = [
        {
          number: 100,
          title: 'Bad phase',
          labels: [{ name: 'Phase: No Number' }],
        },
        {
          number: 200,
          title: 'Good phase',
          labels: [{ name: 'Phase 1: MVP' }],
        },
      ];

      vi.mocked(mockGithub.listIssues).mockResolvedValue(mockIssues);

      const result = await issueQueueService.fetch();

      // Good phase should score higher
      expect(result[0].number).toBe(200);
      expect(result[1].score).toBe(-100); // Malformed phase gets 0 phase score: 0*10000 + 0*1000 - 100
    });

    it('computes correct score formula', async () => {
      const mockIssues: Issue[] = [
        {
          number: 42,
          title: 'Test issue',
          labels: [{ name: 'Phase 3: GA' }, { name: 'p1' }],
        },
      ];

      vi.mocked(mockGithub.listIssues).mockResolvedValue(mockIssues);

      const result = await issueQueueService.fetch();

      // Phase 3 = 100 - 3 = 97, p1 = 2
      // Score = 97 * 10000 + 2 * 1000 - 42 = 971958
      expect(result[0].score).toBe(971958);
    });
  });
});
