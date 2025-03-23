import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import mkcert from 'vite-plugin-mkcert';
import topLevelAwait from 'vite-plugin-top-level-await';
import wasm from 'vite-plugin-wasm';
import tsconfigPaths from 'vite-tsconfig-paths';

// Local plugins
import { cleanUrlHandler } from './vite-clean-urls';
import { getCanvasFiles, linkGenerator } from './vite-link-generator';
import { remark } from './vite-remark-md';

const websiteDir = resolve(__dirname, './src');
const canvasWebsiteDir = resolve(__dirname, './src/canvas');

function getEntryPoints() {
  // Main index
  const entries: Record<string, string> = {
    index: resolve(websiteDir, 'index.html'),
  };

  // Add site-level folders
  ['file-space', 'hyperzoom', 'canvas'].forEach((section) => {
    entries[section] = resolve(websiteDir, section, 'index.html');
  });

  // Add all canvas files
  getCanvasFiles(canvasWebsiteDir).forEach((file) => {
    const key = `canvas/${file.relativePath.replace('.html', '')}`;
    entries[key] = resolve(canvasWebsiteDir, file.fullPath);
  });

  return entries;
}

export default defineConfig({
  root: 'website',
  plugins: [
    cleanUrlHandler(websiteDir),
    linkGenerator(canvasWebsiteDir),
    mkcert(),
    wasm(),
    topLevelAwait(),
    remark(),
    tsconfigPaths({
      root: __dirname,
      loose: true,
    }),
  ],
  resolve: {
    // Ensure proper resolution for local packages
    alias: {
      '@folkjs/lib': resolve(__dirname, '../packages/lib/src'),
      '@folkjs/labs': resolve(__dirname, '../packages/labs/src'),
      '@folkjs/propagators': resolve(__dirname, '../packages/propagators/src'),
      '@folkjs/geometry': resolve(__dirname, '../packages/geometry/src'),
    },
  },
  optimizeDeps: {
    // Ensure Vite properly processes our local packages
    include: ['@folkjs/lib', '@folkjs/labs', '@folkjs/propagators', '@folkjs/geometry'],
    // Make sure type-only imports are properly handled
    esbuildOptions: {
      logLevel: 'error',
      tsconfigRaw: {
        compilerOptions: {
          preserveValueImports: true,
        },
      },
    },
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      input: getEntryPoints(),
    },
    outDir: './dist',
    emptyOutDir: true,
  },
});
