import { readdirSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import type { IndexHtmlTransformContext, Plugin } from 'vite';

// Simple configuration
const CONFIG = {
  excludedGroups: ['temp', 'tests'],
  hiddenPrefix: '_',
  indexFilename: 'index.html',
  htmlExtension: '.html',
  canvasPath: 'canvas',
  templateMarker: '{{ LINKS }}',
};

// A canvas file with its metadata
interface CanvasFile {
  fullPath: string; // Full path to the file (needed for vite.config.ts)
  relativePath: string; // Path relative to base dir
  group: string | null; // Directory name or null if in root
  displayName: string; // Human-readable name
}

/**
 * Get all canvas files in the given directory
 */
export function getCanvasFiles(baseDir: string): CanvasFile[] {
  const canvasFiles: CanvasFile[] = [];

  // Recursively scan directories
  const scanDirectory = (dir: string) => {
    readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      const fullPath = resolve(dir, entry.name);

      if (entry.isDirectory()) {
        scanDirectory(fullPath);
      } else if (extname(entry.name) === CONFIG.htmlExtension && entry.name !== CONFIG.indexFilename) {
        // Get path relative to base directory
        const relativePath = relative(baseDir, fullPath);
        const dirName = dirname(relativePath);

        canvasFiles.push({
          fullPath,
          relativePath,
          group: dirName === '.' ? null : dirName,
          displayName: basename(entry.name, CONFIG.htmlExtension).replaceAll('-', ' '),
        });
      }
    });
  };

  scanDirectory(baseDir);
  return canvasFiles;
}

/**
 * Generate a link for a canvas file
 */
function formatLink(file: CanvasFile): string {
  const url = `./${CONFIG.canvasPath}/${file.relativePath.replace(CONFIG.htmlExtension, '')}`;
  return `<li><a href="${url}">${file.displayName}</a></li>`;
}

/**
 * Generate links for a group of files
 */
function generateGroupLinks(groupName: string | null, files: CanvasFile[]): string {
  // Sort files by display name
  const sortedFiles = [...files].sort((a, b) => a.displayName.localeCompare(b.displayName));
  const linksHtml = sortedFiles.map(formatLink).join('\n');

  // For root files, just return the links
  if (groupName === null) {
    return linksHtml;
  }

  // For grouped files, add a heading
  const groupTitle = groupName.replaceAll('-', ' ');
  return `\n<h2 id="${groupName}">${groupTitle}</h2>\n<ul>${linksHtml}</ul>`;
}

/**
 * Vite plugin to generate links in the canvas index page
 */
export const linkGenerator = (baseDir: string): Plugin => {
  return {
    name: 'link-generator',
    transformIndexHtml(html: string, ctx: IndexHtmlTransformContext) {
      // Only process canvas/index.html
      if (!ctx.filename.includes(join(CONFIG.canvasPath, CONFIG.indexFilename))) {
        return html;
      }

      // Get all valid canvas files (excluding those in excluded groups)
      const validFiles = getCanvasFiles(baseDir).filter(
        (file) => !file.group || !CONFIG.excludedGroups.includes(file.group),
      );

      if (validFiles.length === 0) {
        return html;
      }

      // Group files by their group
      const filesByGroup: Record<string, CanvasFile[]> = {};
      validFiles.forEach((file) => {
        if (file.relativePath.includes(CONFIG.hiddenPrefix)) return;

        const group = file.group ?? 'root';
        filesByGroup[group] = filesByGroup[group] || [];
        filesByGroup[group].push(file);
      });

      // Generate HTML for each group
      let resultHtml = '';

      // Add root files first if they exist
      if (filesByGroup['root']) {
        resultHtml += generateGroupLinks(null, filesByGroup['root']);
        delete filesByGroup['root'];
      }

      // Add all other groups in alphabetical order
      Object.keys(filesByGroup)
        .sort()
        .forEach((groupName) => {
          resultHtml += generateGroupLinks(groupName, filesByGroup[groupName]);
        });

      // Insert HTML into template
      return html.replace(CONFIG.templateMarker, resultHtml);
    },
  };
};
