import { defineConfig } from 'vite';

import { resolve } from 'node:path';

export default defineConfig({
  build: {
    target: 'esnext',
    lib: {
      entry: [
        resolve(__dirname, './src/background.ts'),
        resolve(__dirname, './src/content-script.ts'),
        resolve(__dirname, './src/injected.ts'),
      ],
      formats: ['es'],
    },
    outDir: './dist',
    emptyOutDir: true,
    minify: false,
  },
});
