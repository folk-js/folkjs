import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  plugins: [wasm()],
  build: {
    lib: {
      entry: resolve(__dirname, 'dist/automerge.js'),
      formats: ['es'],
      fileName: () => 'automerge.js',
    },
    emptyOutDir: false,
    minify: false,
    sourcemap: true,
  },
});
