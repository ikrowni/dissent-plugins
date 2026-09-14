import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['plugins/**/*.test.js', 'scripts/**/*.test.mjs', 'services/**/*.test.mjs'],
    passWithNoTests: false,
  },
});
