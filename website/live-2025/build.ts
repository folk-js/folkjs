import { existsSync, readFileSync, writeFileSync } from 'fs';
import matter from 'gray-matter';
import { Marked } from 'marked';
import markedFootnote from 'marked-footnote';
import markedKatex from 'marked-katex-extension';
import { basename } from 'path';
// @ts-ignore - Package doesn't have TypeScript declarations
import { parse as parseBibtex } from '@retorquere/bibtex-parser';

const MARKDOWN_FILE = 'live-2025/live.md';
const BIBTEX_FILE = 'live-2025/folkjs.bib';
const OUTPUT_FILE = 'live-2025/index.html';
const ROOT_DIR = '.';

interface PostData {
  slug: string;
  title: string;
  content: string;
  frontmatter: any;
  readingTime: number;
}

interface BibEntry {
  key: string;
  type: string;
  fields: Record<string, any>;
}

function parseBibliography(): Map<string, BibEntry> {
  const bibEntries = new Map<string, BibEntry>();

  if (!existsSync(BIBTEX_FILE)) {
    console.log(`${BIBTEX_FILE} not found, skipping bibliography...`);
    return bibEntries;
  }

  try {
    const bibContent = readFileSync(BIBTEX_FILE, 'utf-8');
    const parsed = parseBibtex(bibContent);

    for (const entry of parsed.entries) {
      bibEntries.set(entry.key, {
        key: entry.key,
        type: entry.type,
        fields: entry.fields,
      });
    }

    console.log(`📚 Parsed ${bibEntries.size} bibliography entries`);
  } catch (error) {
    console.error('Error parsing bibliography:', error);
  }

  return bibEntries;
}

function formatAuthor(author: string): string {
  // Handle "Last, First" format and clean up
  if (author.includes(',')) {
    const parts = author.split(',').map((p) => p.trim());
    if (parts.length === 2) {
      return `${parts[1]} ${parts[0]}`;
    }
  }
  return author;
}

function formatBibEntry(entry: BibEntry): string {
  const fields = entry.fields;

  // Format authors
  let authors = '';
  if (fields.author) {
    let authorList: string[] = [];

    if (Array.isArray(fields.author)) {
      // Handle structured author objects: {firstName: "John", lastName: "Doe"}
      authorList = fields.author.map((author: any) => {
        if (author.firstName && author.lastName) {
          return `${author.firstName} ${author.lastName}`;
        } else if (author.lastName) {
          return author.lastName;
        } else {
          return String(author);
        }
      });
    } else if (typeof fields.author === 'string') {
      // Handle string format with " and " separators
      authorList = fields.author.split(' and ').map(formatAuthor);
    }

    // Format the author list
    if (authorList.length === 1) {
      authors = authorList[0];
    } else if (authorList.length === 2) {
      authors = `${authorList[0]} and ${authorList[1]}`;
    } else if (authorList.length > 2) {
      authors = `${authorList.slice(0, -1).join(', ')}, and ${authorList[authorList.length - 1]}`;
    }
  }

  // Helper function to get field value as string
  const getFieldValue = (field: any): string => {
    if (Array.isArray(field)) {
      return field.join(', ');
    }
    return String(field || '');
  };

  // Format based on entry type
  switch (entry.type.toLowerCase()) {
    case 'article':
      let articleRef = `${authors}, "${getFieldValue(fields.title)},"`;

      const journal = getFieldValue(fields.journaltitle || fields.journal);
      if (journal) {
        articleRef += ` ${journal}`;

        const volume = getFieldValue(fields.volume);
        const number = getFieldValue(fields.number);

        if (volume) articleRef += `, vol. ${volume}`;
        if (number) articleRef += `, no. ${number}`;
      }

      const articleDate = getFieldValue(fields.date || fields.year);
      if (articleDate) articleRef += `, ${articleDate}`;

      articleRef += '.';
      if (fields.doi) articleRef += ` doi: ${getFieldValue(fields.doi)}.`;

      return articleRef;

    case 'inproceedings':
      let procRef = `${authors}, "${getFieldValue(fields.title)}," in ${getFieldValue(fields.booktitle)}`;

      const location = getFieldValue(fields.location);
      const publisher = getFieldValue(fields.publisher);
      if (location && publisher) {
        procRef += `, ${location}: ${publisher}`;
      } else if (publisher) {
        procRef += `, ${publisher}`;
      }

      const procDate = getFieldValue(fields.date || fields.year);
      if (procDate) procRef += `, ${procDate}`;

      procRef += '.';
      if (fields.doi) procRef += ` doi: ${getFieldValue(fields.doi)}.`;

      return procRef;

    case 'online':
      const accessed = fields.urldate ? ` Accessed: ${getFieldValue(fields.urldate)}.` : '';
      return `${authors || getFieldValue(fields.title)}, "${getFieldValue(fields.title)}"${accessed} [Online]. Available: ${getFieldValue(fields.url)}`;

    case 'book':
      return `${authors}, "${getFieldValue(fields.title)}," ${getFieldValue(fields.publisher)}, ${getFieldValue(fields.date || fields.year)}.`;

    case 'thesis':
      return `${authors}, "${getFieldValue(fields.title)}," ${getFieldValue(fields.type) || 'Thesis'}, ${getFieldValue(fields.date || fields.year)}.`;

    default:
      // Fallback format
      return `${authors}, "${getFieldValue(fields.title)}," ${getFieldValue(fields.date || fields.year)}.`;
  }
}

function processCitations(
  content: string,
  bibEntries: Map<string, BibEntry>,
): { content: string; usedCitations: Set<string> } {
  const usedCitations = new Set<string>();
  const citationPattern = /@([a-zA-Z0-9]+)/g;

  // Replace @citations with [^citations]
  const processedContent = content.replace(citationPattern, (match, key) => {
    if (bibEntries.has(key)) {
      usedCitations.add(key);
      return `[^${key}]`;
    } else {
      console.warn(`⚠️  Citation key "${key}" not found in bibliography`);
      return match; // Keep original if not found
    }
  });

  return { content: processedContent, usedCitations };
}

function generateReferences(usedCitations: Set<string>, bibEntries: Map<string, BibEntry>): string {
  if (usedCitations.size === 0) return '';

  let references = '\n# References\n\n';

  // Sort citations by their keys
  const sortedCitations = Array.from(usedCitations).sort();

  for (const bibKey of sortedCitations) {
    const entry = bibEntries.get(bibKey);
    if (entry) {
      const formatted = formatBibEntry(entry);
      references += `[^${bibKey}]: ${formatted}\n\n`;
    }
  }

  return references;
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

  // Parse authors from frontmatter
  const authors = post.frontmatter.author
    ? post.frontmatter.author.split(',').map((author: string) => author.trim())
    : [];

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
            <header style="text-align: center; margin-top: 3rem; margin-bottom: 3rem;">
        <h1 style="margin: 0 0 1rem 0; font-size: 2.5rem;">${post.title}</h1>
        ${
          authors.length > 0
            ? `
                   <div class="authors" style="display: flex; justify-content: center; gap: 4rem; margin-bottom: 1rem; flex-wrap: wrap;">
          ${authors.map((author: string) => `<span class="author" style="color: var(--text-primary); font-weight: 500;">${author}</span>`).join('')}
        </div>
        `
            : ''
        }
        <div style="color: var(--text-secondary); font-size: 0.9rem;">
          ${dateStr ? `${dateStr} • ` : ''}<a href="/artifacts/live-2025.pdf" 
             style="color: var(--text-secondary, #666); text-decoration: none; border-bottom: 1px solid transparent; transition: border-color 0.2s;"
             onmouseover="this.style.borderBottomColor='var(--text-secondary, #666)'"
             onmouseout="this.style.borderBottomColor='transparent'">PDF</a>
        </div>
      </header>
      
      <style>
        /* hide the auto-generated footnote heading */
        #footnote-label {
          display: none;
        }
        
        @media (max-width: 767px) {
          .post header h1 {
            font-size: 2rem !important;
          }
          .post header {
            margin-top: 2rem !important;
          }
        }
      </style>
      
      <script>
        // Randomize author order on page load
        document.addEventListener('DOMContentLoaded', function() {
          const authorsContainer = document.querySelector('.authors');
          if (authorsContainer) {
            const authorElements = Array.from(authorsContainer.children);
            
            // Fisher-Yates shuffle algorithm
            for (let i = authorElements.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [authorElements[i], authorElements[j]] = [authorElements[j], authorElements[i]];
            }
            
            // Clear container and append shuffled elements
            authorsContainer.innerHTML = '';
            authorElements.forEach(element => authorsContainer.appendChild(element));
          }
        });
      </script>
      
      ${post.content}
    </main>
  </body>
</html>`;
}

function processMarkdownFile(
  filePath: string,
  bibEntries: Map<string, BibEntry>,
): { postData: PostData; usedCitations: Set<string> } {
  const content = readFileSync(filePath, 'utf-8');
  const { content: markdownContent, data: frontmatter } = matter(content);
  const slug = basename(filePath, '.md');
  const title = frontmatter.title || slug;

  // Process citations first
  const { content: processedMarkdown, usedCitations } = processCitations(markdownContent, bibEntries);

  // Add references before markdown processing
  const references = generateReferences(usedCitations, bibEntries);
  const markdownWithReferences = processedMarkdown + references;

  // Configure marked to handle media files and LaTeX
  // Section numbering state
  const sectionNumbers: number[] = [];

  const marked = new Marked()
    .use(markedFootnote())
    // .use(
    //   markedKatex({
    //     throwOnError: false,
    //   }),
    // )
    .use({
      renderer: {
        heading(text: string, level: number) {
          // Skip numbering for References and Abstract sections
          if (text.toLowerCase() === 'references' || text.toLowerCase() === 'abstract') {
            const id = text
              .toLowerCase()
              .replace(/[^\w\- ]/g, '')
              .replace(/\s+/g, '-');
            return `<h${level} id="${id}">${text}</h${level}>`;
          }

          // Update section numbering
          if (level === 1) {
            sectionNumbers.length = 1;
            sectionNumbers[0] = (sectionNumbers[0] || 0) + 1;
          } else if (level === 2) {
            sectionNumbers.length = 2;
            sectionNumbers[1] = (sectionNumbers[1] || 0) + 1;
          } else if (level === 3) {
            sectionNumbers.length = 3;
            sectionNumbers[2] = (sectionNumbers[2] || 0) + 1;
          } else {
            // For deeper levels, just continue the pattern
            sectionNumbers.length = level;
            for (let i = 0; i < level; i++) {
              if (sectionNumbers[i] === undefined) sectionNumbers[i] = 0;
            }
            sectionNumbers[level - 1] = (sectionNumbers[level - 1] || 0) + 1;
          }

          // Generate section number string
          const sectionNumber = sectionNumbers.slice(0, level).join('.');

          // Create the heading with section number
          const id = text
            .toLowerCase()
            .replace(/[^\w\- ]/g, '')
            .replace(/\s+/g, '-');
          return `<h${level} id="${id}">${sectionNumber}. ${text}</h${level}>`;
        },
        code(code: string, language?: string) {
          // Convert code blocks to md-syntax elements
          const lang = language ? ` lang="${language}"` : '';
          return `<md-syntax${lang}>${code}</md-syntax>`;
        },
        image(href: string, title: string | null, text: string) {
          // Use relative paths for media files in the live subdirectory
          const mediaPath = href.startsWith('/') ? href : `./live/${href}`;

          let mediaElement = '';

          // For video files, use video tag
          if (mediaPath.match(/\.(mp4|mov)$/i)) {
            mediaElement = `<video controls><source src="${mediaPath}" type="video/${
              mediaPath.endsWith('.mov') ? 'quicktime' : 'mp4'
            }">Your browser does not support the video tag.</video>`;
          } else {
            // For images, use img tag
            mediaElement = `<img src="${mediaPath}" alt="${text || ''}"${title ? ` title="${title}"` : ''}>`;
          }

          // Add caption if text exists
          if (text) {
            return `<figure style="margin: 1rem 0; text-align: center;">
              ${mediaElement}
              <figcaption style="margin-top: 0.5rem; font-style: italic; color: var(--text-secondary, #666); font-size: 0.9rem;">${text}</figcaption>
            </figure>`;
          }

          return mediaElement;
        },
      },
    });

  const htmlContent = marked.parse(markdownWithReferences) as string;
  const readingTime = calculateReadingTime(htmlContent);

  return {
    postData: {
      slug,
      title,
      content: htmlContent,
      frontmatter,
      readingTime,
    },
    usedCitations,
  };
}

export function build() {
  console.log('🔨 Building from live.md...');

  if (!existsSync(MARKDOWN_FILE)) {
    console.log(`${MARKDOWN_FILE} not found, skipping...`);
    return;
  }

  const bibEntries = parseBibliography();
  const { postData, usedCitations } = processMarkdownFile(MARKDOWN_FILE, bibEntries);

  const html = generateHTML(postData);

  // Write the HTML file
  writeFileSync(OUTPUT_FILE, html);

  console.log(`✅ Built ${OUTPUT_FILE} from ${MARKDOWN_FILE}`);
}

// Always run when this file is executed
build();
