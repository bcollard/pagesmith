import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['{src,test}/**/*.{test,spec}.ts'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // src/core decides where the page is scrolled, where each capture lands
      // in the output and what bytes the PDF contains. It is pure, so a gap in
      // its coverage has no excuse. Set per-glob so UI churn cannot lower it.
      include: ['src/core/**/*.ts'],
      thresholds: {
        'src/core/**/*.ts': {
          statements: 95,
          branches: 90,
          functions: 95,
          lines: 95,
        },
      },
    },
  },
});
