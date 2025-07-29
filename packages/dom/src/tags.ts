import { render, html as uhtmlfunc } from 'uhtml';

/**
 * A wrapper around uhtml's html tag that returns an HTMLElement instead of a template.
 * This makes it easier to use uhtml for one-off element creation.
 * @deprecated
 *
 * @example
 * ```ts
 * const el = uhtml`<div>Hello ${name}!</div>`;
 * document.body.appendChild(el);
 * ```
 */
export function uhtml(strings: TemplateStringsArray, ...values: any[]): HTMLElement {
  const container = document.createElement('span');
  render(container, uhtmlfunc(strings, ...values));
  return container;
}

/** A raw tagged template literal that just provides GLSL syntax highlighting/LSP support. */
export const glsl = String.raw;

// Some websites with strict CSP require trusted types for using DOM APIS prone to XSS
const policy = (window as any)?.trustedTypes?.createPolicy('folkjs', {
  createHTML: (s: string) => s,
});

/** A raw tagged template literal that just provides HTML syntax highlighting/LSP support. */
export function html(strings: TemplateStringsArray, ...values: any[]) {
  const str = String.raw(strings, values);
  return policy ? policy.createHTML(str) : str;
}

export function css(strings: TemplateStringsArray, ...values: any[]) {
  const styles = new CSSStyleSheet();
  styles.replaceSync(String.raw(strings, ...values));
  return styles;
}

interface DOMReferences {
  root: HTMLElement;
  [key: string]: HTMLElement;
}

export function html2(strings: TemplateStringsArray, ...values: string[]): DOMReferences {
  const str = strings
    .flatMap((str, i) => {
      if (i >= values.length) return str;

      const value = values[i];
      return str + value;
    })
    .join('');

  const documentFragment = document.createRange().createContextualFragment(str);

  if (documentFragment.firstElementChild === null) throw new Error();

  const refs: DOMReferences = {
    root: documentFragment.firstElementChild as HTMLElement,
  };

  documentFragment.querySelectorAll<HTMLElement>('[ref]').forEach((el) => {
    refs[el.getAttribute('ref')!] = el;
  });

  return refs;
}
