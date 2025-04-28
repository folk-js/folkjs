const INLINE_TAGS = {
  '': ['<em>', '</em>'],
  _: ['<strong>', '</strong>'],
  '*': ['<strong>', '</strong>'],
  '~': ['<s>', '</s>'],
  '\n': ['<br />'],
  ' ': ['<br />'],
  '-': ['<hr />'],
} as const;

/** Outdent a string based on the first indented line's leading whitespace
 *	@private
 */
function outdent(str: string) {
  return str.replace(RegExp('^' + (str.match(/^(\t| )+/) || '')[0], 'gm'), '');
}

/** Encode special attribute characters to HTML entities in a String.
 *	@private
 */
function encodeAttr(str: string) {
  return (str + '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function cleanNewLines(str: string) {
  return str.replace(/^\n+|\n+$/g, '');
}

/** Parse Markdown into an HTML String. */
export function parse(md: string, prevLinks?: Record<string, string>) {
  let tokenizer =
      /((?:^|\n+)(?:\n---+|\* \*(?: \*)+)\n)|(?:^``` *(\w*)\n([\s\S]*?)\n```$)|((?:(?:^|\n+)(?:\t|  {2,}).+)+\n*)|((?:(?:^|\n)([>*+-]|\d+\.)\s+.*)+)|(?:!\[([^\]]*?)\]\(([^)]+?)\))|(\[)|(\](?:\(([^)]+?)\))?)|(?:(?:^|\n+)([^\s].*)\n(-{3,}|={3,})(?:\n+|$))|(?:(?:^|\n+)(#{1,6})\s*(.+)(?:\n+|$))|(?:`([^`].*?)`)|(  \n\n*|\n{2,}|__|\*\*|[_*]|~~)/gm,
    context: string[] = [],
    out = '',
    links = prevLinks || {},
    last = 0,
    chunk,
    prev,
    token,
    inner,
    t;

  function tag(token: string) {
    let desc = INLINE_TAGS[(token[1] as keyof typeof INLINE_TAGS) || ''];
    let end = context[context.length - 1] == token;
    if (!desc) return token;
    if (!desc[1]) return desc[0];
    if (end) context.pop();
    else context.push(token);
    return desc[end ? 1 : 0];
  }

  function flush() {
    let str = '';
    while (context.length) str += tag(context[context.length - 1]);
    return str;
  }

  md = md
    .replace(/^\[(.+?)\]:\s*(.+)$/gm, (s, name, url) => {
      links[name.toLowerCase()] = url;
      return '';
    })
    .replace(/^\n+|\n+$/g, '');

  while ((token = tokenizer.exec(md))) {
    prev = md.substring(last, token.index);
    last = tokenizer.lastIndex;
    chunk = token[0];
    if (prev.match(/[^\\](\\\\)*\\$/)) {
      // escaped
    }
    // Code/Indent blocks:
    else if ((t = token[3] || token[4])) {
      chunk =
        '<pre><code' +
        (token[2] ? ` data-language="${token[2].toLowerCase()}"` : '') +
        '>' +
        outdent(encodeAttr(t).replace(/^\n+|\n+$/g, '')) +
        '</code></pre>';
    }
    // > Quotes, -* lists:
    else if ((t = token[6])) {
      if (t.match(/\./)) {
        token[5] = token[5].replace(/^\d+/gm, '');
      }
      inner = parse(outdent(token[5].replace(/^\s*[>*+.-]/gm, '')));
      if (t == '>') t = 'blockquote';
      else {
        t = t.match(/\./) ? 'ol' : 'ul';
        inner = inner.replace(/^(.*)(\n|$)/gm, '<li>$1</li>');
      }
      chunk = '<' + t + '>' + inner + '</' + t + '>';
    }
    // Images:
    else if (token[8]) {
      chunk = `<img src="${encodeAttr(token[8])}" alt="${encodeAttr(token[7])}" />`;
    }
    // Links:
    else if (token[10]) {
      out = out.replace('<a>', `<a href="${encodeAttr(token[11] || links[prev.toLowerCase()])}">`);
      chunk = flush() + '</a>';
    } else if (token[9]) {
      chunk = '<a>';
    }
    // Headings:
    else if (token[12] || token[14]) {
      t = 'h' + (token[14] ? token[14].length : token[13] > '=' ? 1 : 2);
      chunk = '<' + t + '>' + parse(token[12] || token[15], links) + '</' + t + '>';
    }
    // `code`:
    else if (token[16]) {
      chunk = '<code>' + encodeAttr(token[16]) + '</code>';
    }
    // Inline formatting: *em*, **strong** & friends
    else if (token[17] || token[1]) {
      chunk = tag(token[17] || '--');
    }
    out += prev;
    out += chunk;
  }

  return cleanNewLines(out + md.substring(last) + flush());
}

type Rule = {
  name: string;
  filter: string;
  replace(content: string, node: Element): string;
};

const rules: Rule[] = [
  {
    name: 'paragraph',
    filter: 'p',
    replace: (content) => '\n\n' + content + '\n\n',
  },
  {
    name: 'break',
    filter: 'br',
    replace: () => '\n',
  },
  {
    name: 'heading',
    filter: 'h1, h2, h3, h4, h5, h6',
    replace: (content, node) => `\n\n${'#'.repeat(Number(node.nodeName.charAt(1)))} ${content}\n\n`,
  },
  {
    name: 'blockquote',
    filter: 'blockquote',
    replace(content) {
      content = content.replace(/^\n+|\n+$/g, '');
      content = content.replace(/^/gm, '> ');
      return '\n\n' + content + '\n\n';
    },
  },
  {
    name: 'list',
    filter: 'ul, ol',
    replace(content, node) {
      var parent = node.parentElement!;
      if (parent.nodeName === 'LI' && parent.lastElementChild === node) {
        return `'\n${content}`;
      } else {
        return `\n\n${content}\n\n`;
      }
    },
  },
  {
    name: 'list item',
    filter: 'li',
    replace(content, node) {
      content = content
        .replace(/^\n+/, '') // remove leading newlines
        .replace(/\n+$/, '\n') // replace trailing newlines with just a single one
        .replace(/\n/gm, '\n    '); // indent

      let prefix = '-   ';

      const parent = node.parentElement!;

      if (parent.nodeName === 'OL') {
        const index = Array.prototype.indexOf.call(parent.children, node);
        prefix = `${index + 1}. `;
      }

      return prefix + content + (node.nextSibling && !/\n$/.test(content) ? '\n' : '');
    },
  },
  {
    name: 'fenced code block',
    filter: 'pre:has(> code)',
    replace(content, node) {
      const codeEl = node.firstElementChild as HTMLElement;
      const language = codeEl.dataset.language || '';
      const code = codeEl.textContent || '';

      let fenceSize = 3;
      const fenceChar = '`';
      const fenceInCodeRegex = new RegExp('^' + fenceChar + '{3,}', 'gm');

      let match;
      while ((match = fenceInCodeRegex.exec(code))) {
        if (match[0].length >= fenceSize) {
          fenceSize = match[0].length + 1;
        }
      }

      const fence = fenceChar.repeat(fenceSize);

      return '\n\n' + fence + language + '\n' + code.replace(/\n$/, '') + '\n' + fence + '\n\n';
    },
  },
  {
    name: 'horizontal rule',
    filter: 'hr',
    replace: () => '\n\n---\n\n',
  },
  {
    name: 'external link',
    filter: 'a[href][target="_blank"]',
    replace(content, node) {
      let href = node.getAttribute('href');
      if (href) href = href.replace(/([()])/g, '\\$1');
      return `[${content}](${href})`;
    },
  },
  {
    name: 'wiki link',
    filter: 'a[href^=#]',
    replace(content, node) {
      const href = (node.getAttribute('href') || '').replace('#', '');
      return `[[${href}${content === href ? '' : ` : ${content}`}]]`;
    },
  },
  {
    name: 'image',
    filter: 'img[src]',
    replace: (content, node) => `![${node.getAttribute('alt')}](${node.getAttribute('src')})`,
  },
  {
    name: 'emphasis',
    filter: 'em, i',
    replace: (content) => `_${content}_`,
  },
  {
    name: 'strong',
    filter: 'strong, b',
    replace: (content) => `*${content}*`,
  },
  {
    name: 'strikethrough',
    filter: 's',
    replace: (content) => `~${content}~`,
  },
  {
    name: 'inline code',
    filter: '*:not(pre:has(:only-child)) > code',
    replace(content) {
      content = content.replace(/\r?\n|\r/g, ' ');

      let delimiter = '`';
      const extraSpace = /^`|^ .*?[^ ].* $|`$/.test(content) ? ' ' : '';
      const matches = content.match(/`+/gm);

      while (matches !== null && matches.indexOf(delimiter) !== -1) delimiter = delimiter + '`';

      return delimiter + extraSpace + content + extraSpace + delimiter;
    },
  },
];

const isElement = (node: Node): node is Element => node.nodeType === Node.ELEMENT_NODE;

// Ported from https://github.com/mixmark-io/turndown
export function marshal(html: string | Element | DocumentFragment): string {
  if (typeof html === 'string') {
    html = document.createRange().createContextualFragment(html);
  }

  const strings: string[] = [];
  let node = html.firstChild;

  while (node !== null) {
    if (node.nodeType === Node.TEXT_NODE) {
      // escape text that isn't in a code block
      strings.push(node.nodeValue || '');
    } else if (node.nodeType === Node.COMMENT_NODE) {
      const comment = `<!--${node.nodeValue}-->`;
      strings.push(comment);
    } else if (isElement(node)) {
      const rule = rules.find((r) => (node as Element).matches(r.filter));

      if (rule === undefined) {
        // to support nested markdown we need to parse this node.
        strings.push(node.outerHTML);
      } else {
        const replacement = rule.replace(marshal(node), node);
        strings.push(replacement);
      }
    }

    node = node.nextSibling;
  }

  // Will have to manually join to account for correct newline separation
  return cleanNewLines(strings.join(''));
}
