import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: [
    /(^|\/)tests\/e2e\/.*\.spec\.(ts|tsx)$/,
    /(^|\/)tests\/accessibility\/.*\.spec\.(ts|tsx)$/,
    /(^|\/)apps\/.*\.e2e\.(ts|tsx)$/,
  ],
  outputDir: 'test-results',
});
