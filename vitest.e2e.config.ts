import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['packages/**/*.e2e.ts'], fileParallelism: false, testTimeout: 240000 } });
