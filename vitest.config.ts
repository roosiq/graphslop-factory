import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'apps/**/*.{test,spec}.{ts,tsx,mts,cts}',
      'packages/**/*.{test,spec}.{ts,tsx,mts,cts}',
      'tests/contract/**/*.{test,spec}.{ts,tsx,mts,cts}',
      'tests/integration/**/*.{test,spec}.{ts,tsx,mts,cts}',
      'tests/security/**/*.{test,spec}.{ts,tsx,mts,cts}',
      'tests/performance/**/*.{test,spec}.{ts,tsx,mts,cts}',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/coverage/**'],
    passWithNoTests: true,
  },
});
