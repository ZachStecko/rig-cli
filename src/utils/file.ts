import { access, readFile, mkdir } from 'fs/promises';
import { constants } from 'fs';

/**
 * Checks if a file exists.
 *
 * @param path - Absolute or relative path to check
 * @returns true if the file exists, false otherwise
 */
export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads a file if it exists, returns null if it doesn't.
 * Never throws - treats missing files and read errors the same way.
 *
 * @param path - Path to the file
 * @returns File contents as UTF-8 string, or null if not found/readable
 */
export async function readFileIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Ensures a directory exists, creating it and any parent directories if needed.
 * Idempotent - safe to call even if the directory already exists.
 *
 * @param path - Directory path to create
 */
export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}
