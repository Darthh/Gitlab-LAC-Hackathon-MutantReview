import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/demo-domain/src/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/demo-domain/src/shipping.ts'],
      reporter: ['json-summary', 'json', 'text'],
      reportsDirectory: 'evidence/coverage',
    },
  },
});
