import tla from 'rollup-plugin-tla';
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
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
    wasm(),
    // the vite-plugin-top-level-await doesnt work with iife outputs

    tla(),
    webExtension({
      manifest: 'src/manifest.json',
      additionalInputs: [
        'src/injected/canvasify.ts',
        'src/injected/copy-and-paste.ts',
        'src/injected/presence.ts',
        'src/injected/cross-iframe-relationships.ts',
        'src/injected/dom3d.ts',
        'src/injected/network-indicator.ts',
      ],
    }),
  ],
});
