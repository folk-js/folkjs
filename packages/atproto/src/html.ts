import type { html2 } from './lexicons/garden/lexicon/rational-mastodon';

interface Options {
  DANGEROUS_INCLUDE_SCRIPTS?: boolean;
}

export function jsonToHTML(root: html2.Main, options: Options): string {
  return nodeToString(root, options);
}

export function jsonToDOM(root: html2.Main, options: Options) {
  document.createRange().createContextualFragment(jsonToHTML(root, options));
}

type HTMLNode = html2.Main | html2.DocType | html2.Element | html2.Text | html2.Comment;

function nodeToString(node: HTMLNode, options: Options): string {
  switch (node.$type) {
    case 'garden.lexicon.rational-mastodon.html2':
      return node.children.map((n) => nodeToString(n, options)).join('');
    case 'garden.lexicon.rational-mastodon.html2#docType':
      return '<!doctype html>';
    case 'garden.lexicon.rational-mastodon.html2#comment':
      return '<!--' + node.value + '-->';
    case 'garden.lexicon.rational-mastodon.html2#text':
      return node.value;
    case 'garden.lexicon.rational-mastodon.html2#element': {
      const { tagName, attributes, children } = node;

      if (!options.DANGEROUS_INCLUDE_SCRIPTS && tagName === 'script') return '';

      const attributesString = attributes.map((a) => `${a.name}="${a.value}"`);
      return `<${tagName} ${attributesString}>${children.map((n) => nodeToString(n, options)).join('')}</${tagName}>`;
    }
  }
  return '';
}

export function hmtlToJSON(html: string): html2.Main {
  return DOMToJSON(document.createRange().createContextualFragment(html));
}

export function DOMToJSON(node: Node): html2.Main {
  const root: html2.Main = {
    $type: 'garden.lexicon.rational-mastodon.html2',
    children: [],
  };

  let currentNode;
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_ALL);

  while ((currentNode = walker.nextNode())) {}

  return root;
}
