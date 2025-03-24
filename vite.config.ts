import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import mkcert from 'vite-plugin-mkcert';
import topLevelAwait from 'vite-plugin-top-level-await';
import wasm from 'vite-plugin-wasm';
import tsconfigPaths from 'vite-tsconfig-paths';

// Local plugins
import { cleanUrlHandler } from './_scripts_/vite-clean-urls';
import { getCanvasFiles, linkGenerator } from './_scripts_/vite-link-generator';
import { remark } from './_scripts_/vite-remark-md';

const websiteDir = resolve(__dirname, './website');
const canvasWebsiteDir = resolve(__dirname, './website/canvas');

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
  build: {
    target: 'esnext',
    sourcemap: true,
    rollupOptions: {
      input: getEntryPoints(),
    },
    outDir: './dist',
    emptyOutDir: true,
  },
});
