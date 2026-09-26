import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [
    {
      name: 'externalize-node-builtins',
      enforce: 'pre',
      resolveId(source) {
        if (source.startsWith('node:')) return { id: source, external: true };
        return null;
      },
    },
  ],
  resolve: {
    alias: {
      '@workflowos/core': r('./packages/core/src/index.ts'),
      '@workflowos/store': r('./packages/store/src/index.ts'),
      '@workflowos/llm': r('./packages/llm/src/index.ts'),
      '@workflowos/ingest': r('./packages/ingest/src/index.ts'),
      '@workflowos/discovery': r('./packages/discovery/src/index.ts'),
      '@workflowos/compiler': r('./packages/compiler/src/index.ts'),
      '@workflowos/execution': r('./packages/execution/src/index.ts'),
      '@workflowos/orchestrator': r('./packages/orchestrator/src/index.ts'),
      '@workflowos/mock-apps': r('./apps/mock-apps/src/index.ts'),
    },
  },
  test: {
    globals: true,
    include: ['tests/e2e/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    pool: 'forks',
  },
});
