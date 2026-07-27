import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'apps/**/*.{test,spec}.{ts,tsx,mts,cts}',
      'packages/**/*.{test,spec}.{ts,tsx,mts,cts}',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/coverage/**'],
    passWithNoTests: true,
  },
});
