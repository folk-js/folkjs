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
const policy = window.trustedTypes?.createPolicy('folkjs', {
  createHTML: (s: string) => s,
});

export function css(strings: TemplateStringsArray, ...values: any[]) {
  const styles = new CSSStyleSheet();
  styles.replaceSync(String.raw(strings, ...values));
  return styles;
}

// Extract attribute values from HTML template
type ExtractAttrValues<
  T extends string,
  Attr extends string,
> = T extends `${string}${Attr}="${infer AttrValue}"${infer Rest}` ? AttrValue | ExtractAttrValues<Rest, Attr> : never;

// Find the opening tag that contains a specific attribute value
type ExtractTagForAttrValue<
  T extends string,
  AttrValue extends string,
  Attr extends string,
> = T extends `${string}<${infer TagAndAttrs}>${infer Rest}`
  ? TagAndAttrs extends `${infer Tag} ${infer Attrs}`
    ? Attrs extends `${string}${Attr}="${AttrValue}"${string}`
      ? Tag
      : ExtractTagForAttrValue<Rest, AttrValue, Attr>
    : ExtractTagForAttrValue<Rest, AttrValue, Attr>
  : T extends `${string}<${infer TagAndAttrs}/>${infer Rest}`
    ? TagAndAttrs extends `${infer Tag} ${infer Attrs}`
      ? Attrs extends `${string}${Attr}="${AttrValue}"${string}`
        ? Tag
        : ExtractTagForAttrValue<Rest, AttrValue, Attr>
      : ExtractTagForAttrValue<Rest, AttrValue, Attr>
    : never;

// Map tag names to HTMLElement types
type TagToElement<T extends string> = T extends keyof HTMLElementTagNameMap ? HTMLElementTagNameMap[T] : HTMLElement;

// Build refs type for any attribute
type InferRefs<T extends string, Attr extends string> = {
  frag: DocumentFragment;
} & {
  [K in ExtractAttrValues<T, Attr>]: TagToElement<ExtractTagForAttrValue<T, K, Attr>>;
};

type Expand<T> = T extends infer O ? { [K in keyof O]: O[K] } : never;

export function html<T extends string>(template: T): Expand<InferRefs<T, 'ref'>>;
export function html<T extends string, A extends string>(template: T, attr: A): Expand<InferRefs<T, A>>;
/**
 * Creates a DocumentFragment from an HTML string and extracts element references.
 * It collects references to elements that have a specified attribute (default: 'ref'),
 * making them easily accessible by their attribute value.
 *
 * @param html - The HTML template string to parse
 * @param attr - The attribute name to use for element references (defaults to 'ref')
 * @returns An object containing the DocumentFragment and references to marked elements
 *
 * @example
 * ```typescript
 * const { frag, myButton, myInput } = html3(`
 *   <div>
 *     <button ref="myButton">Click me</button>
 *     <input ref="myInput" type="text" />
 *   </div>
 * `);
 */
export function html<T extends string>(html: T, attr: string = 'ref'): any {
  // For whatever reason @types/trusted-types doesn't update DOM APIs to accept TrustedHTML
  const frag = document
    .createRange()
    .createContextualFragment(policy ? (policy.createHTML(html) as unknown as string) : html);
  const refs: any = { frag };

  for (const el of frag.querySelectorAll<HTMLElement>(`[${attr}]`)) {
    const attrName = el.getAttribute(attr)!;
    refs[attrName] = el;
    // Only remove attribute if it's a default 'ref'
    if (attr === 'ref') {
      el.removeAttribute(attr);
    }
  }

  return refs;
}
