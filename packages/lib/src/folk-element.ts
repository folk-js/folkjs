import { ReactiveElement } from '@lit/reactive-element';

/**
 *  Base class for all custom elements. Extends Lit's `ReactiveElement` and adds some utilities for defining the element.
 * ```ts
 * class MyElement extends FolkElement {
 *   static tagName = 'my-element';
 * }
 * 
 * MyElement.define();
 * ```
 */
export class FolkElement extends ReactiveElement {
  /** Defines the name of the custom element, must include a hyphen or it will error out when defined. */
  static tagName = '';

  /** Defines the custom element with the global CustomElementRegistry, ignored if called more than once. Errors if no tagName is defined or it doesn't include a hyphen. */
  static define() {
    if (customElements.get(this.tagName)) return;

    customElements.define(this.tagName, this);
  }
}
