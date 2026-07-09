import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** The web app's unit tests are pure logic (the tour script and its reducer), so
 *  they run on node with no DOM. The `@/` alias mirrors tsconfig paths. */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
