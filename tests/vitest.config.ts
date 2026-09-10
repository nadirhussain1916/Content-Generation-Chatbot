import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    globals: true,
    projects: [
      {
        // Alias the container SDK to a local stub so Vitest never resolves the real
        // (Node-ESM-unfriendly) @cloudflare/sandbox graph. Tests mock getSandbox anyway.
        resolve: {
          alias: {
            '@cloudflare/sandbox': fileURLToPath(new URL('./stubs/cloudflare-sandbox.ts', import.meta.url)),
          },
        },
        test: {
          name: 'backend',
          environment: 'node',
          include: ['backend/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'frontend',
          environment: 'jsdom',
          include: ['frontend/**/*.test.ts'],
        },
      },
    ],
  },
});
