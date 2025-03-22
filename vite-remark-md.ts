import htmlGenerator from 'remark-html';
import markdownParser from 'remark-parse';
import wikiLink from 'remark-wiki-link';
import { unified } from 'unified';
import { Plugin } from 'vite';

export function remark(): Plugin {
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
