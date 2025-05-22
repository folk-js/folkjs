import { defineConfig } from 'vite';
import webExtension from 'vite-plugin-web-extension';

export default defineConfig({
  build: {
    minify: false,
    emptyOutDir: true,
    modulePreload: {
      polyfill: false,
    },
  },
  plugins: [
    webExtension({
      manifest: 'src/manifest.json',
      additionalInputs: [
        'src/injected/canvasify.ts',
        'src/injected/copy-and-paste.ts',
        'src/injected/presence.ts',
        'src/injected/cross-iframe-relationships.ts',
        'src/injected/dom3d.ts',
      ],
    }),
  ],
});
