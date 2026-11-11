import { defineConfig } from 'vitest/config';

// The physics core is pure TypeScript: tests run in plain Node — no browser,
// no WebXR, no scene graph. (Kept separate from vite.config.ts on purpose so
// the IWSDK dev plugin never loads during tests.)
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
