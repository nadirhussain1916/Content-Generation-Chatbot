import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    projects: [
      {
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
