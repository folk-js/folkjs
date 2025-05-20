import { defineConfig } from 'vite';
import webExtension from 'vite-plugin-web-extension';

export default defineConfig({
  build: {
    emptyOutDir: true,
  },
  plugins: [
    webExtension({
      manifest: 'src/manifest.json',
      additionalInputs: ['src/content-script.ts', 'src/injected.ts'],
    }),
  ],
});
