import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import mkcert from 'vite-plugin-mkcert';
import topLevelAwait from 'vite-plugin-top-level-await';
import wasm from 'vite-plugin-wasm';

// Local plugins
import { cleanUrlHandler } from './__scripts__/vite-clean-urls';
import { getCanvasFiles as getDemoFiles, linkGenerator } from './__scripts__/vite-link-generator';
import { remark } from './__scripts__/vite-remark-md';

const websiteDir = resolve(__dirname, '.');
const demoWebsiteDir = resolve(__dirname, './demos');

function getEntryPoints() {
  // Main index
  const entries: Record<string, string> = {
    index: resolve(websiteDir, 'index.html'),
  };

  // Add site-level folders
  ['file-space', 'hyperzoom', 'chess', 'canvas', 'live-2025', 'substrates-2026', 'frello', 'atproto-canvas'].forEach(
    (section) => {
      entries[section] = resolve(websiteDir, section, 'index.html');
    },
  );

  // Add all canvas files
  getDemoFiles(demoWebsiteDir).forEach((file) => {
    const key = `demos/${file.relativePath.replace('.html', '')}`;
    entries[key] = resolve(demoWebsiteDir, file.fullPath);
  });

  return entries;
}

export default defineConfig({
  plugins: [cleanUrlHandler(websiteDir), linkGenerator(demoWebsiteDir), mkcert(), wasm(), topLevelAwait(), remark()],
  build: {
    target: 'esnext',
    sourcemap: true,
    rollupOptions: {
      input: getEntryPoints(),
      external: ['idb-keyval'],
    },
    modulePreload: {
      polyfill: false,
    },
    outDir: './dist',
    emptyOutDir: true,
  },
});
