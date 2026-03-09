/**
 * Converts a string into a URL-safe slug.
 *
 * Transformations:
 * 1. Convert to lowercase
 * 2. Replace non-alphanumeric characters with hyphens
 * 3. Collapse multiple consecutive hyphens
 * 4. Trim leading/trailing hyphens
 * 5. Truncate to 50 characters
 *
 * @example
 * slugify("Fix: User Authentication Bug!") // "fix-user-authentication-bug"
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-/, '')
    .replace(/-$/, '')
    .slice(0, 50);
}

/**
 * Generates a git branch name from an issue number and title.
 * Format: issue-{number}-{slugified-title}
 *
 * @example
 * branchName(123, "Fix login bug") // "issue-123-fix-login-bug"
 */
export function branchName(issueNumber: number, title: string): string {
  const slug = slugify(title);
  return `issue-${issueNumber}-${slug}`;
}
