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
agent:
  max_turns: 100
`;
      await writeFile(resolve(tempDir, '.rig.yml'), partialConfig, 'utf-8');

      const config = await configManager.load();

      // max_turns should be overridden
      expect(config.agent.max_turns).toBe(100);

      // All other values should be defaults
      expect(config.queue).toEqual(DEFAULT_CONFIG.queue);
      expect(config.test).toEqual(DEFAULT_CONFIG.test);
      expect(config.pr).toEqual(DEFAULT_CONFIG.pr);
    });

    it('uses full user config when all fields provided', async () => {
      const fullConfig = `
agent:
  max_turns: 120
queue:
  default_phase: "Phase 1: MVP"
  default_component: backend
test:
  require_new_tests: false
pr:
  draft: true
  reviewers:
    - alice
    - bob
`;
      await writeFile(resolve(tempDir, '.rig.yml'), fullConfig, 'utf-8');

      const config = await configManager.load();

      expect(config.agent.max_turns).toBe(120);
      expect(config.queue.default_phase).toBe('Phase 1: MVP');
      expect(config.queue.default_component).toBe('backend');
      expect(config.test.require_new_tests).toBe(false);
      expect(config.pr.draft).toBe(true);
      expect(config.pr.reviewers).toEqual(['alice', 'bob']);
    });

    it('handles invalid YAML gracefully and uses defaults', async () => {
      const invalidYaml = `
agent:
  max_turns: not a number
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

    it('deep merges nested objects correctly', async () => {
      const nestedConfig = `
agent:
  max_turns: 50
queue:
  default_phase: "Phase 2"
`;
      await writeFile(resolve(tempDir, '.rig.yml'), nestedConfig, 'utf-8');

      const config = await configManager.load();

      // agent section should have override + other defaults
      expect(config.agent.max_turns).toBe(50);

      // queue section should have override + other defaults
      expect(config.queue.default_phase).toBe('Phase 2');
      expect(config.queue.default_component).toBe(DEFAULT_CONFIG.queue.default_component);

      // Other sections should be unchanged
      expect(config.test).toEqual(DEFAULT_CONFIG.test);
    });

    it('overrides array values completely (not merge)', async () => {
      const arrayConfig = `
pr:
  reviewers:
    - charlie
`;
      await writeFile(resolve(tempDir, '.rig.yml'), arrayConfig, 'utf-8');

      const config = await configManager.load();

      // Array should be completely replaced, not merged
      expect(config.pr.reviewers).toEqual(['charlie']);
      expect(config.pr.draft).toBe(DEFAULT_CONFIG.pr.draft);
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
queue:
  default_phase: null
  default_component: null
`;
      await writeFile(resolve(tempDir, '.rig.yml'), nullConfig, 'utf-8');

      const config = await configManager.load();

      expect(config.queue.default_phase).toBeNull();
      expect(config.queue.default_component).toBeNull();
    });

    it('handles valid YAML with wrong types gracefully', async () => {
      const wrongTypeConfig = `
agent:
  max_turns: "not a number"
test:
  require_new_tests: "not a boolean"
`;
      await writeFile(resolve(tempDir, '.rig.yml'), wrongTypeConfig, 'utf-8');

      const config = await configManager.load();

      // TypeScript can't prevent this at runtime, but we should handle it
      // Values will be whatever YAML parsed them as
      expect(config.agent.max_turns).toBe('not a number');
      expect(config.test.require_new_tests).toBe('not a boolean');
    });

    it('prevents mutation of DEFAULT_CONFIG when no file exists', async () => {
      const config = await configManager.load();

      // Mutate returned config
      config.agent.max_turns = 999;
      config.pr.reviewers.push('hacker');

      // Load again and verify DEFAULT_CONFIG wasn't mutated
      const config2 = await configManager.load();
      expect(config2.agent.max_turns).toBe(DEFAULT_CONFIG.agent.max_turns);
      expect(config2.pr.reviewers).toEqual(DEFAULT_CONFIG.pr.reviewers);
    });

    it('prevents mutation of cached config', async () => {
      const partialConfig = `
agent:
  max_turns: 100
`;
      await writeFile(resolve(tempDir, '.rig.yml'), partialConfig, 'utf-8');

      const config1 = await configManager.load();
      config1.agent.max_turns = 999;
      config1.pr.reviewers.push('hacker');

      // Load again and verify cached config wasn't mutated
      const config2 = await configManager.load();
      expect(config2.agent.max_turns).toBe(100);
      expect(config2.pr.reviewers).toEqual(DEFAULT_CONFIG.pr.reviewers);
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
agent:
  max_turns: 100
`;
      await writeFile(resolve(tempDir, '.rig.yml'), partialConfig, 'utf-8');

      await configManager.load();
      const config1 = configManager.get();
      config1.agent.max_turns = 999;

      // get() again should return original values
      const config2 = configManager.get();
      expect(config2.agent.max_turns).toBe(100);
    });
  });

  describe('getAgent', () => {
    it('returns agent config section', async () => {
      await configManager.load();
      expect(configManager.getAgent()).toEqual(DEFAULT_CONFIG.agent);
    });
  });

  describe('getQueue', () => {
    it('returns queue config section', async () => {
      await configManager.load();
      expect(configManager.getQueue()).toEqual(DEFAULT_CONFIG.queue);
    });
  });

  describe('getTest', () => {
    it('returns test config section', async () => {
      await configManager.load();
      expect(configManager.getTest()).toEqual(DEFAULT_CONFIG.test);
    });
  });

  // DISABLED: Demo feature disabled for redesign
  // describe('getDemo', () => {
  //   it('returns demo config section', async () => {
  //     await configManager.load();
  //     expect(configManager.getDemo()).toEqual(DEFAULT_CONFIG.demo);
  //   });
  // });

  describe('getPr', () => {
    it('returns PR config section', async () => {
      await configManager.load();
      expect(configManager.getPr()).toEqual(DEFAULT_CONFIG.pr);
    });

    it('returns overridden PR config', async () => {
      const prConfig = `
pr:
  draft: true
  reviewers:
    - alice
`;
      await writeFile(resolve(tempDir, '.rig.yml'), prConfig, 'utf-8');

      await configManager.load();
      const pr = configManager.getPr();

      expect(pr.draft).toBe(true);
      expect(pr.reviewers).toEqual(['alice']);
    });
  });
});
