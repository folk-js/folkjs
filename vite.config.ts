import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import htmlGenerator from 'remark-html';
import markdownParser from 'remark-parse';
import wikiLink from 'remark-wiki-link';
import { unified } from 'unified';
import { defineConfig, Plugin } from 'vite';
import mkcert from 'vite-plugin-mkcert';
import topLevelAwait from 'vite-plugin-top-level-await';
import wasm from 'vite-plugin-wasm';
import tsconfigPaths from 'vite-tsconfig-paths';
import { getCanvasFiles, linkGenerator } from './vite-link-generator';

function remark(): Plugin {
  const processor = unified()
    .use(markdownParser)
    .use(htmlGenerator)
    .use(wikiLink, {
      pageResolver: (name: string) => [name],
      hrefTemplate: (permalink: string) => `#${permalink}`,
    });

  return {
    name: 'vite-remark-html',
    async transform(code, id) {
      if (id.endsWith('.md')) {
        const result = await processor.process(code);
        return {
          code: `export default ` + JSON.stringify(result.toString('utf8')),
          map: { mappings: '' },
        };
      }
    },
  };
}

const websiteDir = resolve(__dirname, './website');
const canvasWebsiteDir = resolve(__dirname, './website/canvas');

// Clean URL handler for both dev and preview
function cleanUrlHandler(): Plugin {
  return {
    name: 'clean-url-handler',
    configureServer(server) {
      return () => {
        // Apply clean URL middleware
        server.middlewares.use((req, res, next) => {
          // Skip if URL has a file extension or is the root
          const url = req.originalUrl;
          if (!url || url === '/' || url.includes('.')) {
            return next();
          }

          // Redirect /dir to /dir/
          if (
            !url.endsWith('/') &&
            existsSync(join(websiteDir, url)) &&
            existsSync(join(websiteDir, url, 'index.html'))
          ) {
            res.writeHead(301, { Location: `${url}/` });
            res.end();
            return;
          }

          // Rewrite /dir/ to /dir/index.html
          if (url.endsWith('/')) {
            const indexPath = join(websiteDir, url, 'index.html');
            if (existsSync(indexPath)) {
              req.url = join(url, 'index.html');
              return next();
            }
          }

          // Rewrite /file to /file.html
          const htmlPath = join(websiteDir, `${url}.html`);
          if (existsSync(htmlPath)) {
            req.url = `${url}.html`;
            return next();
          }

          next();
        });
      };
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        // Similar logic for preview server
        const url = req.originalUrl;
        if (!url || url === '/' || url.includes('.')) {
          return next();
        }

        // Redirect /dir to /dir/
        if (
          !url.endsWith('/') &&
          existsSync(join(websiteDir, url)) &&
          existsSync(join(websiteDir, url, 'index.html'))
        ) {
          res.writeHead(301, { Location: `${url}/` });
          res.end();
          return;
        }

        // Rewrite /file to /file.html
        const htmlPath = `${url}.html`;
        if (!url.endsWith('/')) {
          req.url = htmlPath;
          return next();
        }

        next();
      });
    },
  };
}

export default defineConfig({
  root: 'website',
  plugins: [
    cleanUrlHandler(),
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
    rollupOptions: {
      input: {
        index: resolve(__dirname, './website/index.html'),
        fileSpace: resolve(__dirname, './website/file-space/index.html'),
        hyperzoom: resolve(__dirname, './website/hyperzoom/index.html'),
        canvas: resolve(__dirname, './website/canvas/index.html'),
        ...getCanvasFiles(canvasWebsiteDir).reduce(
          (acc, file) => {
            const cleanPath = file.relativePath.replace('.html', '');
            acc[`canvas/${cleanPath}`] = resolve(canvasWebsiteDir, file.fullPath);
            return acc;
          },
          {} as Record<string, string>,
        ),
      },
      output: {
        entryFileNames: 'assets/[name].[hash].js',
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash].[ext]',
      },
    },
    modulePreload: {
      polyfill: false,
    },
    outDir: './dist',
    emptyOutDir: true,
  },
});
