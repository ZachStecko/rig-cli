import { describe, it, expect } from 'vitest';
import { slugify, branchName } from '../../src/utils/slugify.js';

describe('slugify', () => {
  it('lowercases and replaces non-alnum with dashes', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('collapses multiple dashes', () => {
    expect(slugify('foo---bar')).toBe('foo-bar');
  });

  it('trims leading and trailing dashes', () => {
    expect(slugify('--hello--')).toBe('hello');
  });

  it('handles special characters', () => {
    expect(slugify('Add user auth (OAuth 2.0)')).toBe('add-user-auth-oauth-2-0');
  });

  it('truncates to 50 characters', () => {
    const long = 'a'.repeat(100);
    expect(slugify(long).length).toBe(50);
  });

  it('returns empty string for empty input', () => {
    expect(slugify('')).toBe('');
  });
});

describe('branchName', () => {
  it('generates issue-N-slug format', () => {
    expect(branchName(42, 'Add login page')).toBe('issue-42-add-login-page');
  });
});
