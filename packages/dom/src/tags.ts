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

type ExtractRefs<T extends string> = T extends `${string}ref="${infer RefName}"${infer Rest}`
  ? RefName | ExtractRefs<Rest>
  : never;

type ExtractTagForRef<
  T extends string,
  RefName extends string,
> = T extends `${string}<${infer TagAndAttrs}>${infer Rest}`
  ? TagAndAttrs extends `${infer Tag} ${infer Attrs}`
    ? Attrs extends `${string}ref="${RefName}"${string}`
      ? Tag
      : ExtractTagForRef<Rest, RefName>
    : ExtractTagForRef<Rest, RefName>
  : T extends `${string}<${infer TagAndAttrs}/>${infer Rest}`
    ? TagAndAttrs extends `${infer Tag} ${infer Attrs}`
      ? Attrs extends `${string}ref="${RefName}"${string}`
        ? Tag
        : ExtractTagForRef<Rest, RefName>
      : ExtractTagForRef<Rest, RefName>
    : never;

type TagToElement<T extends string> = T extends keyof HTMLElementTagNameMap ? HTMLElementTagNameMap[T] : HTMLElement;

type InferRefs<T extends string> = {
  frag: DocumentFragment;
} & {
  [K in ExtractRefs<T>]: TagToElement<ExtractTagForRef<T, K>>;
};

type Expand<T> = T extends infer O ? { [K in keyof O]: O[K] } : never;

export function html3<T extends string>(template: T): Expand<InferRefs<T>> {
  const frag = document.createRange().createContextualFragment(template);
  const refs: any = { frag };

  for (const el of frag.querySelectorAll<HTMLElement>('[ref]')) {
    refs[el.getAttribute('ref')!] = el;
    el.removeAttribute('ref');
  }

  return refs;
}
