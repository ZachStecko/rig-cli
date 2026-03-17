import { describe, it, expect } from 'vitest';
import {
  COMPONENT_LABELS,
  PRIORITY_LABELS,
  PHASE_LABELS,
  TYPE_LABELS,
  STATUS_LABELS,
  SPECIAL_LABELS,
  ALL_LABELS,
  isValidLabel,
  getAllValidLabels,
  type ValidLabel,
} from '../../src/types/labels.types.js';

describe('labels.types', () => {
  describe('label constants', () => {
    it('should define component labels', () => {
      expect(COMPONENT_LABELS.BACKEND).toBe('backend');
      expect(COMPONENT_LABELS.FRONTEND).toBe('frontend');
      expect(COMPONENT_LABELS.FULLSTACK).toBe('fullstack');
      expect(COMPONENT_LABELS.DEVNET).toBe('devnet');
      expect(COMPONENT_LABELS.NODE).toBe('node');
      expect(COMPONENT_LABELS.INFRA).toBe('infra');
      expect(COMPONENT_LABELS.SERVERLESS).toBe('serverless');
    });

    it('should define priority labels', () => {
      expect(PRIORITY_LABELS.P0).toBe('P0');
      expect(PRIORITY_LABELS.P1).toBe('P1');
      expect(PRIORITY_LABELS.P2).toBe('P2');
      expect(PRIORITY_LABELS.P3).toBe('P3');
      expect(PRIORITY_LABELS.P4).toBe('P4');
    });

    it('should define phase labels', () => {
      expect(PHASE_LABELS.PHASE_1_MVP).toBe('Phase 1: MVP');
      expect(PHASE_LABELS.PHASE_2_ENHANCEMENT).toBe('Phase 2: Enhancement');
      expect(PHASE_LABELS.PHASE_3_POLISH).toBe('Phase 3: Polish');
    });

    it('should define type labels', () => {
      expect(TYPE_LABELS.BUG).toBe('bug');
      expect(TYPE_LABELS.ENHANCEMENT).toBe('enhancement');
      expect(TYPE_LABELS.FEATURE).toBe('feature');
      expect(TYPE_LABELS.REFACTOR).toBe('refactor');
      expect(TYPE_LABELS.DOCS).toBe('docs');
      expect(TYPE_LABELS.CHORE).toBe('chore');
      expect(TYPE_LABELS.TEST).toBe('test');
    });

    it('should define status labels', () => {
      expect(STATUS_LABELS.NEEDS_TRIAGE).toBe('needs-triage');
      expect(STATUS_LABELS.NEEDS_REVIEW).toBe('needs-review');
      expect(STATUS_LABELS.IN_PROGRESS).toBe('in-progress');
      expect(STATUS_LABELS.BLOCKED).toBe('blocked');
      expect(STATUS_LABELS.READY).toBe('ready');
    });

    it('should define special labels', () => {
      expect(SPECIAL_LABELS.RIG_GENERATED).toBe('rig-generated');
      expect(SPECIAL_LABELS.RIG_CREATED).toBe('rig-created');
    });

    it('should aggregate all labels in ALL_LABELS', () => {
      const allLabelValues = Object.values(ALL_LABELS);

      // Check that all category labels are included
      expect(allLabelValues).toContain('backend');
      expect(allLabelValues).toContain('P0');
      expect(allLabelValues).toContain('Phase 1: MVP');
      expect(allLabelValues).toContain('bug');
      expect(allLabelValues).toContain('needs-triage');
      expect(allLabelValues).toContain('rig-generated');
    });
  });

  describe('isValidLabel', () => {
    it('should return true for valid component labels', () => {
      expect(isValidLabel('backend')).toBe(true);
      expect(isValidLabel('frontend')).toBe(true);
      expect(isValidLabel('fullstack')).toBe(true);
      expect(isValidLabel('devnet')).toBe(true);
      expect(isValidLabel('node')).toBe(true);
      expect(isValidLabel('infra')).toBe(true);
      expect(isValidLabel('serverless')).toBe(true);
    });

    it('should return true for valid priority labels', () => {
      expect(isValidLabel('P0')).toBe(true);
      expect(isValidLabel('P1')).toBe(true);
      expect(isValidLabel('P2')).toBe(true);
      expect(isValidLabel('P3')).toBe(true);
      expect(isValidLabel('P4')).toBe(true);
    });

    it('should return true for valid phase labels', () => {
      expect(isValidLabel('Phase 1: MVP')).toBe(true);
      expect(isValidLabel('Phase 2: Enhancement')).toBe(true);
      expect(isValidLabel('Phase 3: Polish')).toBe(true);
    });

    it('should return true for valid type labels', () => {
      expect(isValidLabel('bug')).toBe(true);
      expect(isValidLabel('enhancement')).toBe(true);
      expect(isValidLabel('feature')).toBe(true);
      expect(isValidLabel('refactor')).toBe(true);
      expect(isValidLabel('docs')).toBe(true);
      expect(isValidLabel('chore')).toBe(true);
      expect(isValidLabel('test')).toBe(true);
    });

    it('should return true for valid status labels', () => {
      expect(isValidLabel('needs-triage')).toBe(true);
      expect(isValidLabel('needs-review')).toBe(true);
      expect(isValidLabel('in-progress')).toBe(true);
      expect(isValidLabel('blocked')).toBe(true);
      expect(isValidLabel('ready')).toBe(true);
    });

    it('should return true for valid special labels', () => {
      expect(isValidLabel('rig-generated')).toBe(true);
      expect(isValidLabel('rig-created')).toBe(true);
    });

    it('should return false for invalid labels', () => {
      expect(isValidLabel('invalid-label')).toBe(false);
      expect(isValidLabel('random')).toBe(false);
      expect(isValidLabel('foo')).toBe(false);
      expect(isValidLabel('bar')).toBe(false);
      expect(isValidLabel('')).toBe(false);
    });

    it('should be case-sensitive', () => {
      expect(isValidLabel('Backend')).toBe(false); // Should be 'backend'
      expect(isValidLabel('BACKEND')).toBe(false);
      expect(isValidLabel('p0')).toBe(false); // Should be 'P0'
    });
  });

  describe('getAllValidLabels', () => {
    it('should return an array of all valid labels', () => {
      const labels = getAllValidLabels();

      expect(Array.isArray(labels)).toBe(true);
      expect(labels.length).toBeGreaterThan(0);
    });

    it('should include labels from all categories', () => {
      const labels = getAllValidLabels();

      // Component
      expect(labels).toContain('backend');
      expect(labels).toContain('frontend');

      // Priority
      expect(labels).toContain('P0');
      expect(labels).toContain('P1');

      // Phase
      expect(labels).toContain('Phase 1: MVP');

      // Type
      expect(labels).toContain('bug');
      expect(labels).toContain('enhancement');

      // Status
      expect(labels).toContain('needs-triage');

      // Special
      expect(labels).toContain('rig-generated');
    });

    it('should not contain duplicates', () => {
      const labels = getAllValidLabels();
      const uniqueLabels = [...new Set(labels)];

      expect(labels.length).toBe(uniqueLabels.length);
    });
  });

  describe('ValidLabel type', () => {
    it('should accept valid label strings', () => {
      const label1: ValidLabel = 'backend';
      const label2: ValidLabel = 'P0';
      const label3: ValidLabel = 'bug';

      expect(label1).toBe('backend');
      expect(label2).toBe('P0');
      expect(label3).toBe('bug');
    });

    // This test verifies type safety at compile time
    it('should create arrays of valid labels', () => {
      const labels: ValidLabel[] = ['backend', 'frontend', 'P0', 'bug'];

      expect(labels.length).toBe(4);
      expect(labels).toContain('backend');
    });
  });
});
