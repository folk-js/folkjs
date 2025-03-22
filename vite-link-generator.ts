import { readdirSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { IndexHtmlTransformContext, Plugin } from 'vite';

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
  path: string; // Path relative to base dir, used for URL
  group: string | null; // Directory name or null if in root
  displayName: string; // Human-readable name
  fullPath: string; // Full path to the file (needed for vite.config.ts)
  relativePath: string; // Path relative to base dir (for compatibility)
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
      } else if (
        extname(entry.name) === CONFIG.htmlExtension &&
        entry.name !== CONFIG.indexFilename &&
        !entry.name.startsWith(CONFIG.hiddenPrefix)
      ) {
        // Get path relative to base directory
        const relativePath = relative(baseDir, fullPath);
        const dirName = dirname(relativePath);

        canvasFiles.push({
          path: relativePath,
          relativePath: relativePath,
          fullPath: fullPath,
          group: dirName === '.' ? null : dirName,
          displayName: basename(entry.name, CONFIG.htmlExtension).replaceAll('-', ' '),
        });
      }
    });
  };

  scanDirectory(baseDir);
  return canvasFiles;
}

export const linkGenerator = (baseDir: string): Plugin => {
  return {
    name: 'link-generator',
    transformIndexHtml(html: string, ctx: IndexHtmlTransformContext) {
      // Only process canvas/index.html
      if (!ctx.filename.includes(join(CONFIG.canvasPath, CONFIG.indexFilename))) {
        return html;
      }

      // --- Step 1: Find all canvas files ---
      const canvasFiles = getCanvasFiles(baseDir);

      // --- Step 2: Filter and prepare files ---

      // Remove files in excluded groups
      const validFiles = canvasFiles.filter((file) => !file.group || !CONFIG.excludedGroups.includes(file.group));

      // Separate files into ungrouped and grouped
      const ungroupedFiles = validFiles.filter((file) => file.group === null);
      const groupedFiles = validFiles.filter((file) => file.group !== null);

      // --- Step 3: Generate HTML ---

      // Format a single link
      const formatLink = (file: CanvasFile) => {
        const url = `/${CONFIG.canvasPath}/${file.path.replace(CONFIG.htmlExtension, '')}`;
        return `<li><a href="${url}">${file.displayName}</a></li>`;
      };

      // Generate HTML for ungrouped files
      let resultHtml = '';

      if (ungroupedFiles.length > 0) {
        // Sort by display name
        ungroupedFiles.sort((a, b) => a.displayName.localeCompare(b.displayName));

        // Create HTML links
        const ungroupedLinksHtml = ungroupedFiles.map(formatLink).join('\n');
        resultHtml += ungroupedLinksHtml;
      }

      // Generate HTML for grouped files
      if (groupedFiles.length > 0) {
        // Create a map of group name -> files
        const groupMap: Record<string, CanvasFile[]> = {};

        // Group files by their group name
        groupedFiles.forEach((file) => {
          const group = file.group as string;
          groupMap[group] = groupMap[group] || [];
          groupMap[group].push(file);
        });

        // Sort group names alphabetically
        const sortedGroupNames = Object.keys(groupMap).sort();

        // Generate HTML for each group
        for (const groupName of sortedGroupNames) {
          const groupTitle = groupName.replaceAll('-', ' ');
          const groupFiles = groupMap[groupName];

          // Sort files in this group by display name
          groupFiles.sort((a, b) => a.displayName.localeCompare(b.displayName));

          // Create links for this group
          const groupLinksHtml = groupFiles.map(formatLink).join('\n');

          // Add group heading and links to result
          resultHtml += `\n<h2 id="${groupName}">${groupTitle}</h2>\n<ul>${groupLinksHtml}</ul>`;
        }
      }

      // --- Step 4: Insert HTML into template ---
      return html.replace(CONFIG.templateMarker, resultHtml);
    },
  };
};
