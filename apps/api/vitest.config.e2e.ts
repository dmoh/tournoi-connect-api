import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Une seule base de test : les fichiers s'exécutent l'un après l'autre.
    fileParallelism: false,
  },
});
