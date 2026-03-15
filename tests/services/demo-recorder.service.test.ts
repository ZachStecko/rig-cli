import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DemoRecorderService } from '../../src/services/demo-recorder.service.js';
import { Logger } from '../../src/services/logger.service.js';
import { ConfigManager } from '../../src/services/config-manager.service.js';
import { TemplateEngine } from '../../src/services/template-engine.service.js';
import { exec } from '../../src/utils/shell.js';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { readFile } from 'fs/promises';

vi.mock('../../src/utils/shell.js');
vi.mock('fs');
vi.mock('fs/promises');

describe('DemoRecorderService', () => {
  let service: DemoRecorderService;
  let mockLogger: Logger;
  let mockConfig: ConfigManager;
  let mockTemplateEngine: TemplateEngine;
  const projectRoot = '/test/project';

  beforeEach(() => {
    vi.clearAllMocks();

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      success: vi.fn(),
      dim: vi.fn(),
    } as any;

    mockConfig = {
      get: vi.fn(),
    } as any;

    mockTemplateEngine = {
      render: vi.fn(),
    } as any;

    service = new DemoRecorderService(
      mockLogger,
      mockConfig,
      mockTemplateEngine,
      projectRoot
    );

    // Default mocks
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(mkdirSync).mockReturnValue(undefined);
    vi.mocked(readFile).mockResolvedValue('template content');
    vi.mocked(readdirSync).mockReturnValue([] as any);
    vi.mocked(writeFileSync).mockReturnValue(undefined);
    vi.mocked(mockConfig.get).mockReturnValue({
      demo: { enabled: true },
    } as any);
    vi.mocked(mockTemplateEngine.render).mockReturnValue('rendered tape');
  });

  describe('recordFrontendDemo', () => {
    it('records demo with issue-specific script', async () => {
      // Mock issue-specific script exists
      vi.mocked(existsSync).mockImplementation((path: any) => {
        if (path.includes('issue-42.ts')) return true;
        if (path.includes('node_modules')) return true;
        if (path.includes('.rig-reviews')) return true;
        return false;
      });

      // Mock readdirSync to return video file
      vi.mocked(readdirSync).mockReturnValue(['demo.webm'] as any);

      // Mock successful playwright execution
      vi.mocked(exec).mockResolvedValue({
        exitCode: 0,
        stdout: 'Tests passed',
        stderr: '',
      });

      const result = await service.recordFrontendDemo(42);

      expect(result.success).toBe(true);
      expect(result.skipped).toBeFalsy();
      expect(result.demoPath).toContain('.rig-reviews/issue-42');
      expect(mockLogger.info).toHaveBeenCalledWith('Recording frontend demo...');
      expect(mockLogger.success).toHaveBeenCalled();
      expect(exec).toHaveBeenCalledWith(expect.stringContaining('playwright test'));
    });

    it('uses fallback script when issue-specific script does not exist', async () => {
      // Mock only fallback script exists
      vi.mocked(existsSync).mockImplementation((path: any) => {
        if (path.includes('dashboard-demo.ts')) return true;
        if (path.includes('node_modules')) return true;
        if (path.includes('.rig-reviews')) return true;
        return false;
      });

      vi.mocked(readdirSync).mockReturnValue(['demo.mp4'] as any);

      vi.mocked(exec).mockResolvedValue({
        exitCode: 0,
        stdout: 'Tests passed',
        stderr: '',
      });

      const result = await service.recordFrontendDemo(42);

      expect(result.success).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'No issue-specific Playwright demo. Using fallback dashboard demo.'
      );
      expect(exec).toHaveBeenCalledWith(expect.stringContaining('dashboard-demo.ts'));
    });

    it('skips when no demo script found', async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const result = await service.recordFrontendDemo(42);

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'No Playwright demo script found. Skipping frontend demo.'
      );
      expect(exec).not.toHaveBeenCalled();
    });

    it('skips when Playwright not installed', async () => {
      // Mock script exists but node_modules doesn't
      vi.mocked(existsSync).mockImplementation((path: any) => {
        if (path.includes('issue-42.ts')) return true;
        if (path.includes('.rig-reviews')) return true;
        return false;
      });

      const result = await service.recordFrontendDemo(42);

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Playwright not installed. Run 'rig bootstrap' first."
      );
      expect(exec).not.toHaveBeenCalled();
    });

    it('handles Playwright execution failure', async () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        if (path.includes('issue-42.ts')) return true;
        if (path.includes('node_modules')) return true;
        if (path.includes('.rig-reviews')) return true;
        return false;
      });

      vi.mocked(exec).mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'Playwright failed',
      });

      const result = await service.recordFrontendDemo(42);

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(result.output).toBe('Playwright failed');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Playwright demo recording failed (non-fatal)'
      );
    });

    it('skips when no video artifacts created', async () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        if (path.includes('issue-42.ts')) return true;
        if (path.includes('node_modules')) return true;
        if (path.includes('.rig-reviews')) return true;
        return false;
      });

      vi.mocked(readdirSync).mockReturnValue(['readme.txt'] as any); // No video files

      vi.mocked(exec).mockResolvedValue({
        exitCode: 0,
        stdout: 'Tests passed',
        stderr: '',
      });

      const result = await service.recordFrontendDemo(42);

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
    });

    it('creates demo directory if it does not exist', async () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        if (path.includes('issue-42.ts')) return true;
        if (path.includes('node_modules')) return true;
        // Demo dir doesn't exist initially
        return false;
      });

      vi.mocked(readdirSync).mockReturnValue(['demo.webm'] as any);

      vi.mocked(exec).mockResolvedValue({
        exitCode: 0,
        stdout: 'Tests passed',
        stderr: '',
      });

      await service.recordFrontendDemo(42);

      expect(mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('.rig-reviews/issue-42'),
        { recursive: true }
      );
    });

    it('accepts custom timestamp', async () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        if (path.includes('issue-42.ts')) return true;
        if (path.includes('node_modules')) return true;
        if (path.includes('.rig-reviews')) return true;
        return false;
      });

      vi.mocked(readdirSync).mockReturnValue(['demo.webm'] as any);

      vi.mocked(exec).mockResolvedValue({
        exitCode: 0,
        stdout: 'Tests passed',
        stderr: '',
      });

      const result = await service.recordFrontendDemo(42, '2026-03-09-120000');

      expect(result.success).toBe(true);
    });
  });

  describe('recordBackendDemo', () => {
    it('records demo with VHS using template', async () => {
      // Mock VHS available
      vi.mocked(exec).mockImplementation(async (cmd: string) => {
        if (cmd.includes('which vhs')) {
          return { exitCode: 0, stdout: '/usr/bin/vhs', stderr: '' };
        }
        if (cmd.includes('vhs')) {
          return { exitCode: 0, stdout: 'Recording...', stderr: '' };
        }
        return { exitCode: 1, stdout: '', stderr: '' };
      });

      // Mock template exists and output gif exists
      vi.mocked(existsSync).mockImplementation((path: any) => {
        if (path.includes('demo-backend.tape')) return true;
        if (path.includes('.gif')) return true;
        if (path.includes('.rig-reviews')) return true;
        return false;
      });

      const result = await service.recordBackendDemo(42);

      expect(result.success).toBe(true);
      expect(result.skipped).toBeFalsy();
      expect(result.demoPath).toContain('.gif');
      expect(mockLogger.info).toHaveBeenCalledWith('Recording terminal demo with VHS...');
      expect(mockLogger.success).toHaveBeenCalled();
      expect(writeFileSync).toHaveBeenCalled(); // Template written
      expect(mockTemplateEngine.render).toHaveBeenCalled();
    });

    it('uses issue-specific tape file if it exists', async () => {
      vi.mocked(exec).mockImplementation(async (cmd: string) => {
        if (cmd.includes('which vhs')) {
          return { exitCode: 0, stdout: '/usr/bin/vhs', stderr: '' };
        }
        if (cmd.includes('vhs')) {
          return { exitCode: 0, stdout: 'Recording...', stderr: '' };
        }
        return { exitCode: 1, stdout: '', stderr: '' };
      });

      // Mock issue-specific tape exists
      vi.mocked(existsSync).mockImplementation((path: any) => {
        if (path.includes('demo-issue-42.tape')) return true;
        if (path.includes('.gif')) return true;
        if (path.includes('.rig-reviews')) return true;
        return false;
      });

      const result = await service.recordBackendDemo(42);

      expect(result.success).toBe(true);
      expect(writeFileSync).not.toHaveBeenCalled(); // No template rendering needed
    });

    it('skips when VHS not installed', async () => {
      vi.mocked(exec).mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'not found',
      });

      const result = await service.recordBackendDemo(42);

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'VHS not installed. Skipping terminal demo.'
      );
      expect(mockLogger.dim).toHaveBeenCalledWith(
        'Install: https://github.com/charmbracelet/vhs'
      );
    });

    it('skips when no tape file found', async () => {
      vi.mocked(exec).mockResolvedValue({
        exitCode: 0,
        stdout: '/usr/bin/vhs',
        stderr: '',
      });

      vi.mocked(existsSync).mockReturnValue(false);

      const result = await service.recordBackendDemo(42);

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'No VHS tape file found. Skipping terminal demo.'
      );
    });

    it('handles VHS execution failure', async () => {
      vi.mocked(exec).mockImplementation(async (cmd: string) => {
        if (cmd.includes('which vhs')) {
          return { exitCode: 0, stdout: '/usr/bin/vhs', stderr: '' };
        }
        if (cmd.includes('vhs')) {
          return { exitCode: 1, stdout: '', stderr: 'VHS failed' };
        }
        return { exitCode: 1, stdout: '', stderr: '' };
      });

      vi.mocked(existsSync).mockImplementation((path: any) => {
        if (path.includes('demo-backend.tape')) return true;
        if (path.includes('.rig-reviews')) return true;
        // Gif doesn't exist (VHS failed)
        return false;
      });

      const result = await service.recordBackendDemo(42);

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'VHS demo recording failed (non-fatal)'
      );
    });

    it('skips when gif not created despite successful execution', async () => {
      vi.mocked(exec).mockImplementation(async (cmd: string) => {
        if (cmd.includes('which vhs')) {
          return { exitCode: 0, stdout: '/usr/bin/vhs', stderr: '' };
        }
        if (cmd.includes('vhs')) {
          return { exitCode: 0, stdout: 'Recording...', stderr: '' };
        }
        return { exitCode: 1, stdout: '', stderr: '' };
      });

      vi.mocked(existsSync).mockImplementation((path: any) => {
        if (path.includes('demo-backend.tape')) return true;
        // Directory exists but gif file doesn't
        if (path.includes('.rig-reviews') && !path.includes('.gif')) return true;
        // Gif doesn't exist
        return false;
      });

      const result = await service.recordBackendDemo(42);

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
    });

    it('creates demo directory if it does not exist', async () => {
      vi.mocked(exec).mockImplementation(async (cmd: string) => {
        if (cmd.includes('which vhs')) {
          return { exitCode: 0, stdout: '/usr/bin/vhs', stderr: '' };
        }
        if (cmd.includes('vhs')) {
          return { exitCode: 0, stdout: 'Recording...', stderr: '' };
        }
        return { exitCode: 1, stdout: '', stderr: '' };
      });

      vi.mocked(existsSync).mockImplementation((path: any) => {
        if (path.includes('demo-backend.tape')) return true;
        if (path.includes('.gif')) return true;
        // Demo dir doesn't exist initially
        if (path.includes('.rig-reviews')) return false;
        return false;
      });

      await service.recordBackendDemo(42);

      expect(mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('.rig-reviews/issue-42'),
        { recursive: true }
      );
    });
  });

  describe('recordDemo', () => {
    // Demo feature disabled for redesign - recordDemo always returns skipped
    it('always skips with disabled message', async () => {
      const result = await service.recordDemo(42, 'backend');

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(mockLogger.dim).toHaveBeenCalledWith(
        'Demo recording disabled - feature being redesigned'
      );
    });

    it('skips for frontend component', async () => {
      const result = await service.recordDemo(42, 'frontend');

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
    });

    it('skips for fullstack component', async () => {
      const result = await service.recordDemo(42, 'fullstack');

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
    });
  });

  describe('getDemoPath', () => {
    it('returns path when demo directory exists with gif files', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue(['demo-2026-03-09.gif', 'other.txt'] as any);

      const path = service.getDemoPath(42);

      expect(path).toContain('.rig-reviews/issue-42');
    });

    it('returns null when demo directory does not exist', () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const path = service.getDemoPath(42);

      expect(path).toBeNull();
    });

    it('returns null when directory exists but no gif files', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue(['readme.txt'] as any);

      const path = service.getDemoPath(42);

      expect(path).toBeNull();
    });

    it('returns null when readdirSync throws', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const path = service.getDemoPath(42);

      expect(path).toBeNull();
    });

    it('only counts files starting with demo- as valid gifs', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue(['other.gif', 'image.gif'] as any);

      const path = service.getDemoPath(42);

      expect(path).toBeNull();
    });
  });
});
