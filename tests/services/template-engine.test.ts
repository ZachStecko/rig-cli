import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TemplateEngine } from '../../src/services/template-engine.js';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { resolve } from 'path';
import { tmpdir } from 'os';

describe('TemplateEngine', () => {
  let engine: TemplateEngine;
  let tempDir: string;
  let tempFile: string;

  beforeEach(async () => {
    engine = new TemplateEngine();
    tempDir = resolve(tmpdir(), `rig-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    tempFile = resolve(tempDir, 'test-template.txt');
  });

  afterEach(async () => {
    try {
      await unlink(tempFile);
    } catch {
      // File might not exist, ignore
    }
  });

  describe('render', () => {
    it('replaces a single variable', () => {
      const result = engine.render('Hello {{name}}!', { name: 'Alice' });
      expect(result).toBe('Hello Alice!');
    });

    it('replaces multiple variables', () => {
      const template = 'Issue #{{number}}: {{title}}';
      const vars = { number: 123, title: 'Fix bug' };
      const result = engine.render(template, vars);
      expect(result).toBe('Issue #123: Fix bug');
    });

    it('replaces the same variable multiple times', () => {
      const template = '{{name}} says hello. {{name}} is happy.';
      const result = engine.render(template, { name: 'Bob' });
      expect(result).toBe('Bob says hello. Bob is happy.');
    });

    it('handles nested object properties with dot notation', () => {
      const template = 'Issue {{issue.number}}: {{issue.title}}';
      const vars = {
        issue: {
          number: 456,
          title: 'Add feature',
        },
      };
      const result = engine.render(template, vars);
      expect(result).toBe('Issue 456: Add feature');
    });

    it('handles deeply nested properties', () => {
      const template = 'User: {{user.profile.name}}';
      const vars = {
        user: {
          profile: {
            name: 'Charlie',
          },
        },
      };
      const result = engine.render(template, vars);
      expect(result).toBe('User: Charlie');
    });

    it('leaves undefined variables unreplaced', () => {
      const template = 'Hello {{name}}, issue {{number}}';
      const vars = { name: 'Alice' };
      const result = engine.render(template, vars);
      expect(result).toBe('Hello Alice, issue {{number}}');
    });

    it('leaves variables with missing nested paths unreplaced', () => {
      const template = '{{issue.number}} - {{issue.missing.key}}';
      const vars = { issue: { number: 123 } };
      const result = engine.render(template, vars);
      expect(result).toBe('123 - {{issue.missing.key}}');
    });

    it('handles number values', () => {
      const result = engine.render('Count: {{count}}', { count: 42 });
      expect(result).toBe('Count: 42');
    });

    it('handles boolean values', () => {
      const template = 'Enabled: {{enabled}}, Disabled: {{disabled}}';
      const vars = { enabled: true, disabled: false };
      const result = engine.render(template, vars);
      expect(result).toBe('Enabled: true, Disabled: false');
    });

    it('handles empty string values', () => {
      const result = engine.render('Value: "{{value}}"', { value: '' });
      expect(result).toBe('Value: ""');
    });

    it('handles templates with no variables', () => {
      const template = 'This is plain text with no variables.';
      const result = engine.render(template, {});
      expect(result).toBe(template);
    });

    it('handles empty template', () => {
      const result = engine.render('', { name: 'Alice' });
      expect(result).toBe('');
    });

    it('handles empty vars object', () => {
      const template = 'Hello {{name}}!';
      const result = engine.render(template, {});
      expect(result).toBe('Hello {{name}}!');
    });

    it('preserves special characters in values', () => {
      const template = 'Message: {{msg}}';
      const vars = { msg: 'Hello! @user #123 $money & more...' };
      const result = engine.render(template, vars);
      expect(result).toBe('Message: Hello! @user #123 $money & more...');
    });

    it('handles variables with underscores and numbers', () => {
      const template = '{{var_name_123}} and {{VAR_2}}';
      const vars = { var_name_123: 'first', VAR_2: 'second' };
      const result = engine.render(template, vars);
      expect(result).toBe('first and second');
    });

    it('handles multiline templates', () => {
      const template = `Line 1: {{line1}}
Line 2: {{line2}}
Line 3: {{line3}}`;
      const vars = { line1: 'first', line2: 'second', line3: 'third' };
      const result = engine.render(template, vars);
      expect(result).toBe(`Line 1: first
Line 2: second
Line 3: third`);
    });
  });

  describe('renderFile', () => {
    it('reads and renders a template file', async () => {
      const template = 'Hello {{name}}, welcome to {{place}}!';
      await writeFile(tempFile, template, 'utf-8');

      const result = await engine.renderFile(tempFile, {
        name: 'Alice',
        place: 'Wonderland',
      });

      expect(result).toBe('Hello Alice, welcome to Wonderland!');
    });

    it('handles multiline template files', async () => {
      const template = `# Issue {{number}}

Title: {{title}}
Status: {{status}}`;
      await writeFile(tempFile, template, 'utf-8');

      const result = await engine.renderFile(tempFile, {
        number: 123,
        title: 'Fix bug',
        status: 'open',
      });

      expect(result).toBe(`# Issue 123

Title: Fix bug
Status: open`);
    });

    it('throws when file does not exist', async () => {
      await expect(
        engine.renderFile('/nonexistent/file.txt', {})
      ).rejects.toThrow();
    });
  });
});
