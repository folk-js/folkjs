import { html, render } from 'uhtml';

/**
 * A wrapper around uhtml's html tag that returns an HTMLElement instead of a template.
 * This makes it easier to use uhtml for one-off element creation.
 *
 * @example
 * ```ts
 * const el = uhtml`<div>Hello ${name}!</div>`;
 * document.body.appendChild(el);
 * ```
 */
export function uhtml(strings: TemplateStringsArray, ...values: any[]): HTMLElement {
  const container = document.createElement('span');
  render(container, html(strings, ...values));
  return container;
}
