import { CustomAttribute } from '@folkjs/dom/CustomAttribute';
import { css } from '@folkjs/dom/tags';
import { Prism } from 'prism-esm';
import { loader as CssLoader } from 'prism-esm/components/prism-css.js';
import { loader as JsLoader } from 'prism-esm/components/prism-javascript.js';
import { loader as JsonLoader } from 'prism-esm/components/prism-json.js';
import { loader as TsLoader } from 'prism-esm/components/prism-typescript.js';

// Forked from https://github.com/andreruffert/syntax-highlight-element

// TODO: dynamic loading of languages from attribute value

type SupportedLanguage = 'js' | 'ts' | 'css' | 'javascript' | 'typescript' | 'json';

const LANGUAGE_MAP: Record<SupportedLanguage, string> = {
  js: 'javascript',
  ts: 'typescript',
  css: 'css',
  javascript: 'javascript',
  typescript: 'typescript',
  json: 'json',
};

const prism = new Prism();
JsLoader(prism);
TsLoader(prism);
CssLoader(prism);
JsonLoader(prism);

interface TokenHighlight {
  tokenType: string;
  range: Range;
}

interface PrismToken {
  type?: string;
  content: string | PrismToken[];
  length: number;
}

/**
 *
 * @param text - The text to tokenize.
 * @param language - The syntax language grammar.
 * @returns An array of flattened prismjs tokens.
 */
function tokenize(text: string, language: string): PrismToken[] {
  const lang = prism.languages[language] || undefined;
  const tokens = prism.tokenize(text, lang);
  return tokens.flatMap(getFlatToken);
}

/**
 * Flatten tokens for e.g. html attributes etc.
 * @param token - A prismjs token object.
 */
function getFlatToken(token: any): PrismToken | PrismToken[] {
  if (typeof token?.content === 'string') {
    return token;
  }

  if (Array.isArray(token.content)) {
    const insideTokens = token.content.flatMap((x: any) =>
      typeof x === 'string' ? { type: token.type, content: x, length: x.length } : x,
    );
    return insideTokens.flatMap(getFlatToken);
  }

  return token;
}

/**
 * Syntax highlighting attribute using Prism.js and CSS Custom Highlight API.
 *
 * Supported languages via attribute value:
 * - 'js' | 'javascript' → JavaScript syntax highlighting
 * - 'ts' | 'typescript' → TypeScript syntax highlighting
 * - 'css' → CSS syntax highlighting
 * - 'json' → JSON syntax highlighting
 *
 * If no attribute value is provided, the language is inferred from the element:
 * - `<style>` elements → CSS
 * - `<script>` elements → JavaScript (or JSON for importmaps)
 *
 * **Note**: The CSS Highlight API doesn't support form elements like `<textarea>` or `<input>`.
 * Use `contenteditable` elements instead for editable syntax-highlighted content.
 *
 * @example
 * ```html
 * <pre folk-syntax="js">console.log('Hello!');</pre>
 * <div folk-syntax="ts" contenteditable>const x: string = 'typed';</div>
 * <style folk-syntax>body { color: red; }</style>
 * ```
 */
export class FolkSyntaxAttribute extends CustomAttribute {
  static override attributeName = 'folk-syntax';

  static styles = css`
    @layer folk {
      /*
       * INFO:
       * (1.) Currently not a supported property for the highlight pseudo-elements.
       * Full list of supported properties: https://drafts.csswg.org/css-pseudo-4/#highlight-styling
       * More infos: https://github.com/w3c/csswg-drafts/issues/8355
       */

      ::highlight(punctuation),
      ::highlight(atrule) {
        color: light-dark(#1f2328, #f0f6fc);
      }

      ::highlight(number) {
        color: light-dark(#e36209, #ffa657);
      }

      ::highlight(namespace) {
        opacity: 0.7;
      }

      ::highlight(comment),
      ::highlight(prolog),
      ::highlight(doctype),
      ::highlight(cdata) {
        color: light-dark(#6a737d, #8b949e);
      }

      ::highlight(constant),
      ::highlight(builtin) {
        color: light-dark(#8250df, #a5a2ff);
      }

      ::highlight(attr-name),
      ::highlight(char),
      ::highlight(operator) {
        color: light-dark(#0969da, #79c0ff);
      }

      ::highlight(property),
      ::highlight(tag),
      ::highlight(boolean),
      ::highlight(symbol) {
        color: light-dark(#0969da, #79c0ff);
      }

      ::highlight(entity),
      ::highlight(selector),
      ::highlight(class-name) {
        color: light-dark(#6639ba, #ffa657);
      }

      ::highlight(function) {
        color: light-dark(#8250df, #d2a8ff);
      }

      ::highlight(keyword),
      ::highlight(rule) {
        color: light-dark(#cf222e, #ff7b72);
      }

      ::highlight(string),
      ::highlight(attr-value) {
        color: light-dark(#22863a, #7ee787);
      }

      ::highlight(variable) {
        color: light-dark(#e36209, #ffa657);
      }

      ::highlight(regex) {
        font-weight: bold; /* (1.) */
        color: light-dark(#116329, #7ee787);
      }

      ::highlight(italic) {
        font-style: italic; /* (1.) */
        color: light-dark(#f0f6fc, #f0f6fc);
      }

      ::highlight(bold) {
        font-weight: bold; /* (1.) */
        color: light-dark(#f0f6fc, #f0f6fc);
      }

      ::highlight(deleted) {
        color: light-dark(#82071e, #ffdcd7);
        background-color: light-dark(#ffebe9, #67060c);
      }

      ::highlight(inserted) {
        color: light-dark(#116329, #aff5b4);
        background-color: light-dark(#dafbe1, #033a16);
      }

      ::highlight(url) {
        text-decoration: underline;
        color: light-dark(#0a3069, #a5d6ff);
      }

      ::highlight(important) {
        color: light-dark(#0550ae, #1f6feb);
      }

      /* CSS language overwrites */
      ::highlight(css-important) {
        color: light-dark(#cf222e, #ff7b72);
      }

      /* Markdown specific tokens */
      ::highlight(md-title) {
        color: light-dark(#0550ae, #1f6feb);
      }

      ::highlight(md-list) {
        color: light-dark(#953800, #ffa657);
      }
    }
  `;

  static {
    // Add styles to document
    document.adoptedStyleSheets.push(this.styles);

    if (!CSS.highlights) {
      console.info('CSS Custom Highlight API not supported');
    } else {
      /**
       * Create & register the token `Highlight`'s in the `CSS.highlights` registry.
       * This enables the use of `::highlight(tokenType)` in CSS to style them.
       * https://prismjs.com/tokens.html#standard-tokens
       */
      for (const tokenType of [
        // Standard tokens
        'atrule',
        'attr-name',
        'attr-value',
        'bold',
        'boolean',
        'builtin',
        'cdata',
        'char',
        'class-name',
        'comment',
        'constant',
        'deleted',
        'doctype',
        'entity',
        'function',
        'important',
        'inserted',
        'italic',
        'keyword',
        'namespace',
        'number',
        'operator',
        'prolog',
        'property',
        'punctuation',
        'regex',
        'rule',
        'selector',
        'string',
        'symbol',
        'tag',
        'url',
      ]) {
        CSS.highlights.set(tokenType, new Highlight());
      }
    }
  }

  #highlights = new Set<TokenHighlight>();
  #mutationObserver: MutationObserver | undefined;

  get language(): string {
    const attributeValue = this.value;
    const inferredLanguage = this.#inferLanguage();

    // If we have an attribute value, try to map it to a Prism language
    if (attributeValue) {
      const mappedLanguage = LANGUAGE_MAP[attributeValue as SupportedLanguage];
      if (mappedLanguage) {
        return mappedLanguage;
      }
      // If it's not in our map but might be a valid Prism language, use it directly
      return attributeValue;
    }

    // Fall back to inferred language, then plaintext
    return inferredLanguage || 'plaintext';
  }

  #inferLanguage(): string {
    const element = this.ownerElement;

    if (element.localName === 'style') {
      return LANGUAGE_MAP.css;
    } else if (element.localName === 'script') {
      if ((element as HTMLScriptElement).type === 'importmap') {
        return LANGUAGE_MAP.json;
      } else {
        return LANGUAGE_MAP.javascript;
      }
    }

    return '';
  }

  override connectedCallback(): void {
    // Make focusable via keyboard navigation if not already set
    if (!this.ownerElement.hasAttribute('tabindex')) {
      this.ownerElement.setAttribute('tabindex', '0');
    }

    // Set role for accessibility
    if (this.ownerElement.getAttribute('role') === null) {
      this.ownerElement.setAttribute('role', 'code');
    }

    // Listen for input events (for editable elements)
    this.ownerElement.addEventListener('input', this.#onTextChange);

    // Watch for programmatic text changes with MutationObserver
    this.#mutationObserver = new MutationObserver(this.#onTextChange);
    this.#mutationObserver.observe(this.ownerElement, {
      childList: true,
    });

    this.paint();
  }

  override disconnectedCallback(): void {
    this.ownerElement.removeEventListener('input', this.#onTextChange);
    this.#mutationObserver?.disconnect();
    this.#mutationObserver = undefined;
    this.clear();
  }

  override changedCallback(_oldLanguage: string, _newLanguage: string): void {
    this.update();
  }

  #onTextChange = () => {
    this.update();
  };

  paint() {
    if (!CSS.highlights) return;
    const text = this.ownerElement.textContent || '';
    const tokens = tokenize(text, this.language);

    // Get all text nodes to map positions correctly
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(this.ownerElement, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      textNodes.push(node as Text);
    }

    if (textNodes.length === 0) return;

    let globalPos = 0;
    for (const token of tokens) {
      if (token.type) {
        const range = this.#createRangeForPosition(textNodes, globalPos, token.length);
        if (range) {
          CSS.highlights.get(token.type)?.add(range);
          this.#highlights.add({ tokenType: token.type, range });
        }
      }
      globalPos += token.length;
    }
  }

  #createRangeForPosition(textNodes: Text[], startPos: number, length: number): Range | null {
    let currentPos = 0;
    let startNode: Text | null = null;
    let startOffset = 0;
    let endNode: Text | null = null;
    let endOffset = 0;

    // Find start position
    for (const node of textNodes) {
      const nodeLength = node.textContent?.length || 0;
      if (currentPos + nodeLength > startPos) {
        startNode = node;
        startOffset = startPos - currentPos;
        break;
      }
      currentPos += nodeLength;
    }

    if (!startNode) return null;

    // Find end position
    const endPos = startPos + length;
    currentPos = 0;
    for (const node of textNodes) {
      const nodeLength = node.textContent?.length || 0;
      if (currentPos + nodeLength >= endPos) {
        endNode = node;
        endOffset = endPos - currentPos;
        break;
      }
      currentPos += nodeLength;
    }

    if (!endNode) return null;

    try {
      const range = new Range();
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
      return range;
    } catch (e) {
      return null;
    }
  }

  clear() {
    for (const { tokenType, range } of this.#highlights) {
      CSS.highlights.get(tokenType)?.delete(range);
    }
    this.#highlights.clear();
  }

  update() {
    this.clear();
    this.paint();
  }
}
