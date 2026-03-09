import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for rig-cli.
 * Tests run in Node environment without globals (explicit imports required).
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
