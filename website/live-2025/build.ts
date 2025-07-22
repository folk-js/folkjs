import { existsSync, readFileSync, writeFileSync } from 'fs';
import matter from 'gray-matter';
import { Marked } from 'marked';
import markedFootnote from 'marked-footnote';
import markedKatex from 'marked-katex-extension';
import { basename } from 'path';

const MARKDOWN_FILE = 'live-2025/live.md';
const OUTPUT_FILE = 'live-2025/index.html';
const ROOT_DIR = '.';

interface PostData {
  slug: string;
  title: string;
  content: string;
  frontmatter: any;
  readingTime: number;
}

function calculateReadingTime(content: string): number {
  // Strip HTML tags and count words
  const textContent = content.replace(/<[^>]*>/g, '');
  const wordCount = textContent.trim().split(/\s+/).length;
  // Average reading speed is ~250 words per minute
  return Math.ceil(wordCount / 250);
}

function generateHTML(post: PostData): string {
  // Format date if available
  const dateStr = post.frontmatter.date
    ? new Date(post.frontmatter.date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${post.title}</title>
    <link rel="icon" type="image/x-icon" href="/favicon.ico?v=4" />
    <link rel="shortcut icon" type="image/x-icon" href="/favicon.ico?v=4" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Recursive:slnt,wght,CASL,CRSV,MONO@-15..0,300..1000,0..1,0..1,0..1&display=swap"
      rel="stylesheet"
    />
    <link rel="stylesheet" href="./css/reset.css" />
    <link rel="stylesheet" href="./css/style.css" />
    <link rel="stylesheet" href="./css/color.css" />
    <link rel="stylesheet" href="./css/md-syntax.css" />

    <!-- KaTeX for LaTeX rendering -->
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css" integrity="sha384-GvrOXuhMATgEsSwCs4smul74iXGOixntILdUW9XmUC6+HX0sLNAK3q71HotJqlAn" crossorigin="anonymous">

    <!-- Social Meta Tags -->
    <meta
      name="description"
      content="${post.frontmatter.description || post.title}"
    />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${post.title}" />
    <meta
      property="og:description"
      content="${post.frontmatter.description || post.title}"
    />
  </head>
  <body>
    <main class="post">
      <div style="display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 1rem;">
        <h1 style="margin: 0;">${post.title}</h1>
        <span style="color: var(--text-secondary); font-size: 0.9em;">
          ${dateStr ? `${dateStr} • ` : ''}${post.readingTime} min read
        </span>
      </div>
      <style>
        @media (max-width: 767px) {
          .post > div:first-child {
            flex-direction: column !important;
            align-items: flex-start !important;
          }
          .post > div:first-child span {
            margin-top: 0.5rem;
          }
        }

        /* hide the auto-generated footnote heading */
        #footnote-label {
          display: none;
        }
      </style>
      ${post.content}
    </main>
  </body>
</html>`;
}

function processMarkdownFile(filePath: string): PostData {
  const content = readFileSync(filePath, 'utf-8');
  const { content: markdownContent, data: frontmatter } = matter(content);
  const slug = basename(filePath, '.md');
  const title = frontmatter.title || slug;

  // Configure marked to handle media files and LaTeX
  const marked = new Marked()
    .use(markedFootnote())
    // .use(
    //   markedKatex({
    //     throwOnError: false,
    //   }),
    // )
    .use({
      renderer: {
        code(code: string, language?: string) {
          // Convert code blocks to md-syntax elements
          const lang = language ? ` lang="${language}"` : '';
          return `<md-syntax${lang}>${code}</md-syntax>`;
        },
        image(href: string, title: string | null, text: string) {
          // Use relative paths for media files in the live subdirectory
          const mediaPath = href.startsWith('/') ? href : `./live/${href}`;

          // For video files, use video tag
          if (mediaPath.match(/\.(mp4|mov)$/i)) {
            return `<video controls><source src="${mediaPath}" type="video/${
              mediaPath.endsWith('.mov') ? 'quicktime' : 'mp4'
            }">Your browser does not support the video tag.</video>`;
          }

          // For images, use img tag
          return `<img src="${mediaPath}" alt="${text || ''}"${title ? ` title="${title}"` : ''}>`;
        },
      },
    });

  const htmlContent = marked.parse(markdownContent) as string;
  const readingTime = calculateReadingTime(htmlContent);

  return {
    slug,
    title,
    content: htmlContent,
    frontmatter,
    readingTime,
  };
}

export function build() {
  console.log('🔨 Building from live.md...');

  if (!existsSync(MARKDOWN_FILE)) {
    console.log(`${MARKDOWN_FILE} not found, skipping...`);
    return;
  }

  const post = processMarkdownFile(MARKDOWN_FILE);
  const html = generateHTML(post);

  // Write the HTML file
  writeFileSync(OUTPUT_FILE, html);

  console.log(`✅ Built ${OUTPUT_FILE} from ${MARKDOWN_FILE}`);
}

// Always run when this file is executed
build();
