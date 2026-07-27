import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './apps',
  testMatch: '**/*.{e2e,spec}.{ts,tsx}',
  outputDir: 'test-results',
});
