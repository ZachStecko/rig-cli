import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GuardService } from '../../src/services/guard.service.js';
import { GitHubService } from '../../src/services/github.service.js';
import { GuardError } from '../../src/types/error.types.js';

describe('GuardService', () => {
  let guardService: GuardService;
  let mockGithub: GitHubService;

  beforeEach(() => {
    mockGithub = {
      isInstalled: vi.fn(),
      isAuthenticated: vi.fn(),
    } as any;

    guardService = new GuardService(mockGithub);
  });

  describe('requireGhAuth', () => {
    it('passes when gh is installed and authenticated', async () => {
      vi.mocked(mockGithub.isInstalled).mockResolvedValue(true);
      vi.mocked(mockGithub.isAuthenticated).mockResolvedValue(true);

      await expect(guardService.requireGhAuth()).resolves.not.toThrow();
    });

    it('throws GuardError when gh is not installed', async () => {
      vi.mocked(mockGithub.isInstalled).mockResolvedValue(false);

      await expect(guardService.requireGhAuth()).rejects.toThrow(GuardError);
      await expect(guardService.requireGhAuth()).rejects.toThrow('not installed');
      await expect(guardService.requireGhAuth()).rejects.toThrow('https://cli.github.com');
    });

    it('throws GuardError when gh is installed but not authenticated', async () => {
      vi.mocked(mockGithub.isInstalled).mockResolvedValue(true);
      vi.mocked(mockGithub.isAuthenticated).mockResolvedValue(false);

      await expect(guardService.requireGhAuth()).rejects.toThrow(GuardError);
      await expect(guardService.requireGhAuth()).rejects.toThrow('not authenticated');
      await expect(guardService.requireGhAuth()).rejects.toThrow('gh auth login');
    });

    it('does not check authentication if gh is not installed', async () => {
      vi.mocked(mockGithub.isInstalled).mockResolvedValue(false);

      await expect(guardService.requireGhAuth()).rejects.toThrow();
      expect(mockGithub.isAuthenticated).not.toHaveBeenCalled();
    });
  });
});
