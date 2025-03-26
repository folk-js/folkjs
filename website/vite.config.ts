import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import mkcert from 'vite-plugin-mkcert';
import topLevelAwait from 'vite-plugin-top-level-await';
import wasm from 'vite-plugin-wasm';

// Local plugins
import { cleanUrlHandler } from './__scripts__/vite-clean-urls';
import { getCanvasFiles, linkGenerator } from './__scripts__/vite-link-generator';
import { remark } from './__scripts__/vite-remark-md';

const websiteDir = resolve(__dirname, '.');
const canvasWebsiteDir = resolve(__dirname, './canvas');

function getEntryPoints() {
  // Main index
  const entries: Record<string, string> = {
    index: resolve(websiteDir, 'index.html'),
  };

  // Add site-level folders
  ['file-space', 'hyperzoom'].forEach((section) => {
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
  plugins: [cleanUrlHandler(websiteDir), linkGenerator(canvasWebsiteDir), mkcert(), wasm(), topLevelAwait(), remark()],
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
