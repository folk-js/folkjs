import { existsSync, readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import htmlGenerator from 'remark-html';
import markdownParser from 'remark-parse';
import wikiLink from 'remark-wiki-link';
import { unified } from 'unified';
import { defineConfig, IndexHtmlTransformContext, Plugin } from 'vite';
import mkcert from 'vite-plugin-mkcert';
import topLevelAwait from 'vite-plugin-top-level-await';
import wasm from 'vite-plugin-wasm';

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

function getCanvasFiles() {
  const files: { path: string; name: string }[] = [];

  // Helper function to read directory recursively
  const readDir = (dir: string, base = '') => {
    readdirSync(dir, { withFileTypes: true }).forEach((dirent) => {
      if (dirent.isDirectory()) {
        readDir(resolve(dir, dirent.name), `${base}${dirent.name}/`);
      } else if (dirent.name.endsWith('.html')) {
        files.push({
          path: `${base}${dirent.name}`,
          name: `${base}${dirent.name}`,
        });
      }
    });
  };

  readDir(canvasWebsiteDir);
  return files;
}

const linkGenerator = (): Plugin => {
  return {
    name: 'link-generator',
    transformIndexHtml(html: string, ctx: IndexHtmlTransformContext) {
      if (!ctx.filename.endsWith('canvas/index.html')) return;
      const files = getCanvasFiles();

      // Handle ungrouped files (in root canvas directory)
      const ungroupedFiles = files.filter(
        (file) => !file.path.includes('/') && !file.name.includes('index') && !file.path.startsWith('_'),
      );

      // Handle grouped files (in subdirectories)
      const groups = files
        .filter((file) => file.path.includes('/'))
        .reduce(
          (acc, file) => {
            const group = file.path.split('/')[0];
            if (!acc[group]) acc[group] = [];
            acc[group].push(file);
            return acc;
          },
          {} as Record<string, typeof files>,
        );

      // Remove special groups from the main groups object without generating HTML
      const specialGroups = ['temp', 'tests'];
      specialGroups.forEach((group) => delete groups[group]);

      // Generate ungrouped HTML
      const ungroupedHtml = ungroupedFiles
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(({ path, name }) => {
          const title = name.replace('.html', '').replaceAll('-', ' ');
          return `<li><a href="/canvas/${path}">${title}</a></li>`;
        })
        .join('\n');

      // Generate remaining grouped HTML
      const groupedHtml = Object.entries(groups)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([group, groupFiles]) => {
          const groupHtml = groupFiles
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(({ path, name }) => {
              const title = name.split('/').pop()?.replace('.html', '').replaceAll('-', ' ') || '';
              return `<li><a href="/canvas/${path}">${title}</a></li>`;
            })
            .join('\n');

          return `<h2 id="${group}">${group.replaceAll('-', ' ')}</h2>\n<ul>${groupHtml}</ul>`;
        })
        .join('\n');

      // Combine only ungrouped and grouped HTML without special groups
      const finalHtml = `${ungroupedHtml}\n${groupedHtml}`;

      return html.replace('{{ LINKS }}', finalHtml);
    },
  };
};

const fallback = (rootDir: string): Plugin => ({
  name: 'html-index-fallback',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const url = req.originalUrl;
      if (url && url !== '/' && !extname(url) && existsSync(join(rootDir, `${url}/index.html`))) {
        res.writeHead(301, { Location: req.url + '/index.html' });
        res.end();
        return;
      }
      next();
    });
  },
});

export default defineConfig({
  root: 'website',
  resolve: {
    alias: {
      '@lib': resolve(__dirname, './lib'),
      '@labs': resolve(__dirname, './labs'),
    },
  },
  plugins: [fallback(websiteDir), linkGenerator(), mkcert(), wasm(), topLevelAwait(), remark()],
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        index: resolve(__dirname, './website/index.html'),
        fileSpace: resolve(__dirname, './website/file-space/index.html'),
        hyperzoom: resolve(__dirname, './website/hyperzoom/index.html'),
        ...getCanvasFiles().reduce(
          (acc, file) => {
            acc[`canvas/${file.name.replace('.html', '')}`] = resolve(canvasWebsiteDir, file.name);
            return acc;
          },
          {} as Record<string, string>,
        ),
      },
    },
    modulePreload: {
      polyfill: false,
    },
    outDir: './dist',
    emptyOutDir: true,
  },
});
