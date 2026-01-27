import RichtextBuilder, { type Facet } from '@atcute/bluesky-richtext-builder';
import type { Did, GenericUri } from '@atcute/lexicons';
import { Parser } from 'commonmark';

export interface Post {
  text: string;
  facets: Facet[];
}

export function markdownToFacets(markdown: string) {
  const parser = new Parser();
  const ast = parser.parse(markdown.trim());
  const posts: Post[] = [];
  let rtb = new RichtextBuilder();

  let event, node;
  const walker = ast.walker();

  while ((event = walker.next())) {
    node = event.node;
    console.log(node.type, node.literal);

    if (event.entering && node.type === 'text') {
      rtb.addText(node.literal || '');
    } else if (event.entering && node.type === 'emph') {
      // rtb.addDecoratedText(node.literal);
    } else if (event.entering && node.type === 'link') {
      // assume there is only a text in a link
      const literal = node.firstChild?.literal || null;

      if (literal === null || node.destination === null) {
        rtb.addText(node.literal || node.destination || '');
      } else if (literal.startsWith('@') && node.destination.startsWith('did:plc:')) {
        rtb.addMention(literal, node.destination as Did);
      } else {
        rtb.addDecoratedText(literal, {
          $type: 'app.bsky.richtext.facet#link',
          uri: node.destination as GenericUri,
        });
      }

      // skip over the text node in the link
      walker.next();
    }
  }

  posts.push({ text: rtb.text, facets: rtb.facets });

  return posts;
}
