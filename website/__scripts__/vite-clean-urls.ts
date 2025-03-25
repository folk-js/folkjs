import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

export function cleanUrlHandler(websiteDir: string): Plugin {
  return {
    name: 'clean-url-handler',
    configureServer(server) {
      return () => {
        server.middlewares.use((req, res, next) => {
          const url = req.originalUrl || '/';

          // Skip assets and root URL
          if (url === '/' || url.includes('.')) {
            return next();
          }

          // Redirect /dir to /dir/ if directory exists with index.html
          if (!url.endsWith('/') && existsSync(join(websiteDir, url, 'index.html'))) {
            res.writeHead(301, { Location: `${url}/` });
            return res.end();
          }

          // Try .html version for clean URLs
          if (!url.endsWith('/') && existsSync(join(websiteDir, `${url}.html`))) {
            req.url = `${url}.html`;
          }

          next();
        });
      };
    },
  };
}
