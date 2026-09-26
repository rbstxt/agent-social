import { readFileSync, writeFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    asocial: 'src/cli.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'node18',
  splitting: false,
  sourcemap: true,
  outDir: 'dist',
  async onSuccess() {
    const body = readFileSync('dist/asocial.js', 'utf-8');
    if (!body.startsWith('#!')) {
      writeFileSync('dist/asocial.js', `#!/usr/bin/env node\n${body}`);
    }
  },
});
