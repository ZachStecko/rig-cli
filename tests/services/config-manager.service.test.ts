import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConfigManager } from '../../src/services/config-manager.service.js';
import { DEFAULT_CONFIG } from '../../src/types/config.types.js';
import { writeFile, mkdir, rm } from 'fs/promises';
import { resolve } from 'path';
import { tmpdir } from 'os';

describe('ConfigManager', () => {
  let tempDir: string;
  let configManager: ConfigManager;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    // Create a unique temp directory for each test (with randomness to avoid collisions)
    tempDir = resolve(tmpdir(), `rig-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
    await mkdir(tempDir, { recursive: true });
    configManager = new ConfigManager(tempDir);

    // Spy on console.warn to verify warning messages
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    consoleWarnSpy.mockRestore();
  });

  describe('load', () => {
    it('returns DEFAULT_CONFIG when .rig.yml does not exist', async () => {
      const config = await configManager.load();
      expect(config).toEqual(DEFAULT_CONFIG);
    });

    it('merges partial config with defaults', async () => {
      const partialConfig = `
git:
  base_branch: develop
`;
      await writeFile(resolve(tempDir, '.rig.yml'), partialConfig, 'utf-8');

      const config = await configManager.load();

      // base_branch should be overridden
      expect(config.git.base_branch).toBe('develop');

      // All other values should be defaults
      expect(config.verbose).toBe(DEFAULT_CONFIG.verbose);
    });

    it('uses full user config when all fields provided', async () => {
      const fullConfig = `
git:
  base_branch: develop
verbose: true
defaultLabels:
  - backend
  - bug
`;
      await writeFile(resolve(tempDir, '.rig.yml'), fullConfig, 'utf-8');

      const config = await configManager.load();

      expect(config.git.base_branch).toBe('develop');
      expect(config.verbose).toBe(true);
      expect(config.defaultLabels).toEqual(['backend', 'bug']);
    });

    it('handles invalid YAML gracefully and uses defaults', async () => {
      const invalidYaml = `
git:
  base_branch: develop
  this is: [invalid yaml
`;
      await writeFile(resolve(tempDir, '.rig.yml'), invalidYaml, 'utf-8');

      const config = await configManager.load();

      expect(config).toEqual(DEFAULT_CONFIG);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to parse .rig.yml')
      );
    });

    it('handles empty .rig.yml file', async () => {
      await writeFile(resolve(tempDir, '.rig.yml'), '', 'utf-8');

      const config = await configManager.load();

      expect(config).toEqual(DEFAULT_CONFIG);
    });

    it('overrides array values completely (not merge)', async () => {
      const arrayConfig = `
defaultLabels:
  - frontend
`;
      await writeFile(resolve(tempDir, '.rig.yml'), arrayConfig, 'utf-8');

      const config = await configManager.load();

      // Array should be completely replaced, not merged
      expect(config.defaultLabels).toEqual(['frontend']);
    });

    it('caches config after first load', async () => {
      const config1 = await configManager.load();
      const config2 = await configManager.load();

      // Should return same values (but different instances due to cloning)
      expect(config1).toStrictEqual(config2);
      expect(config1).not.toBe(config2); // Different instances to prevent mutation
    });

    it('handles null values in user config', async () => {
      const nullConfig = `
git:
  base_branch: null
`;
      await writeFile(resolve(tempDir, '.rig.yml'), nullConfig, 'utf-8');

      const config = await configManager.load();

      expect(config.git.base_branch).toBeNull();
    });

    it('handles valid YAML with wrong types gracefully', async () => {
      const wrongTypeConfig = `
verbose: "not a boolean"
`;
      await writeFile(resolve(tempDir, '.rig.yml'), wrongTypeConfig, 'utf-8');

      const config = await configManager.load();

      // TypeScript can't prevent this at runtime, but we should handle it
      // Values will be whatever YAML parsed them as
      expect(config.verbose).toBe('not a boolean');
    });

    it('prevents mutation of DEFAULT_CONFIG when no file exists', async () => {
      const config = await configManager.load();

      // Mutate returned config
      config.git.base_branch = 'mutated';

      // Load again and verify DEFAULT_CONFIG wasn't mutated
      const config2 = await configManager.load();
      expect(config2.git.base_branch).toBe(DEFAULT_CONFIG.git.base_branch);
    });

    it('prevents mutation of cached config', async () => {
      const partialConfig = `
git:
  base_branch: develop
`;
      await writeFile(resolve(tempDir, '.rig.yml'), partialConfig, 'utf-8');

      const config1 = await configManager.load();
      config1.git.base_branch = 'mutated';

      // Load again and verify cached config wasn't mutated
      const config2 = await configManager.load();
      expect(config2.git.base_branch).toBe('develop');
    });
  });

  describe('get', () => {
    it('returns loaded config after load()', async () => {
      await configManager.load();
      const config = configManager.get();
      expect(config).toEqual(DEFAULT_CONFIG);
    });

    it('throws error if called before load()', () => {
      expect(() => configManager.get()).toThrow('Configuration not loaded');
    });

    it('prevents mutation of config via get()', async () => {
      const partialConfig = `
git:
  base_branch: develop
`;
      await writeFile(resolve(tempDir, '.rig.yml'), partialConfig, 'utf-8');

      await configManager.load();
      const config1 = configManager.get();
      config1.git.base_branch = 'mutated';

      // get() again should return original values
      const config2 = configManager.get();
      expect(config2.git.base_branch).toBe('develop');
    });
  });
});
