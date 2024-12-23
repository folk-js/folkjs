import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, IndexHtmlTransformContext, Plugin } from 'vite';
import mkcert from 'vite-plugin-mkcert';

const canvasWebsiteDir = resolve(__dirname, './website/canvas');

function getCanvasFiles() {
  const files: { path: string; name: string }[] = [];

  // Helper function to read directory recursively
  const readDir = (dir: string, base = '') => {
    readdirSync(dir, { withFileTypes: true }).forEach((dirent) => {
      // Skip directories that start with underscore
      if (dirent.name.startsWith('_')) return;

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
      const ungroupedFiles = files.filter((file) => !file.path.includes('/') && !file.name.includes('index'));

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

      // Generate ungrouped HTML
      const ungroupedHtml = ungroupedFiles
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(({ path, name }) => {
          const title = name.replace('.html', '').replaceAll('-', ' ');
          return `<li><a href="${path}">${title}</a></li>`;
        })
        .join('\n');

      // Generate grouped HTML
      const groupedHtml = Object.entries(groups)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([group, groupFiles]) => {
          const groupHtml = groupFiles
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(({ path, name }) => {
              const title = name.replace('.html', '').replaceAll('-', ' ');
              return `<li><a href="${path}">${title}</a></li>`;
            })
            .join('\n');

          return `<h2>${group.replaceAll('-', ' ')}</h2>\n<ul>${groupHtml}</ul>`;
        })
        .join('\n');

      return html.replace('{{ LINKS }}', `${ungroupedHtml}\n${groupedHtml}`);
    },
  };
};

export default defineConfig({
  root: 'website',
  resolve: {
    alias: {
      '@lib': resolve(__dirname, './lib'),
      '@labs': resolve(__dirname, './labs'),
      '@propagators': resolve(__dirname, './propagators'),
    },
  },
  plugins: [linkGenerator(), mkcert()],
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        index: resolve(__dirname, './website/index.html'),
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
