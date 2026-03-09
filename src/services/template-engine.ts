import { readFile } from 'fs/promises';

/**
 * Simple template engine for replacing {{KEY}} variables.
 *
 * Variables are replaced with values from the vars object.
 * Missing variables are left unreplaced (e.g., {{MISSING}} stays as-is).
 *
 * This is used for:
 * - Prompt templates (agent-prompt.md, review-prompt.md)
 * - PR body templates (pr-body.md)
 * - Demo recording scripts
 */
export class TemplateEngine {
  /**
   * Replaces {{KEY}} placeholders in a template string with values from vars.
   *
   * Variable names are case-sensitive. Nested objects are accessed with dot notation.
   * Missing variables are left as {{KEY}} in the output.
   *
   * @param template - Template string with {{VAR}} placeholders
   * @param vars - Object containing variable values
   * @returns Rendered template with variables replaced
   *
   * @example
   * const engine = new TemplateEngine();
   * const result = engine.render(
   *   "Hello {{name}}, issue #{{issue.number}}",
   *   { name: "Alice", issue: { number: 123 } }
   * );
   * // Returns: "Hello Alice, issue #123"
   */
  render(template: string, vars: Record<string, any>): string {
    return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (match, key) => {
      // Handle nested keys like {{issue.number}}
      const value = this.getNestedValue(vars, key);
      return value !== undefined ? String(value) : match;
    });
  }

  /**
   * Reads a file and renders it as a template.
   *
   * @param filePath - Path to the template file
   * @param vars - Object containing variable values
   * @returns Rendered template with variables replaced
   * @throws If file cannot be read
   *
   * @example
   * const engine = new TemplateEngine();
   * const result = await engine.renderFile(
   *   './templates/pr-body.md',
   *   { issueNumber: 123, branch: 'issue-123-fix-bug' }
   * );
   */
  async renderFile(filePath: string, vars: Record<string, any>): Promise<string> {
    const template = await readFile(filePath, 'utf-8');
    return this.render(template, vars);
  }

  /**
   * Gets a nested value from an object using dot notation.
   * e.g., getNestedValue({ issue: { number: 123 } }, 'issue.number') => 123
   *
   * @private
   */
  private getNestedValue(obj: Record<string, any>, path: string): any {
    const keys = path.split('.');
    let current: any = obj;

    for (const key of keys) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = current[key];
    }

    return current;
  }
}
