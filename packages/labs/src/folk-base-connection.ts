import { type ClientRectObserverEntry, FolkElement, FolkObserver, parseDeepCSSSelector } from '@folkjs/lib';
import { parseVertex } from '@folkjs/lib/utils';
import { css, type CSSResultGroup, type PropertyValues } from '@lit/reactive-element';
import { property, state } from '@lit/reactive-element/decorators.js';

const folkObserver = new FolkObserver();

export class FolkBaseConnection extends FolkElement {
  static override styles: CSSResultGroup = css`
    :host {
      display: block;
      position: absolute;
      inset: 0;
      pointer-events: none;
    }
  `;

  @property({ reflect: true }) source?: string;

  #sourceIframeSelector: string | undefined = undefined;

  @state() sourceElement: Element | null = null;

  @state() sourceRect: DOMRectReadOnly | null = null;

  @property({ reflect: true }) target?: string;

  #targetIframeSelector: string | undefined = undefined;

  @state() targetRect: DOMRectReadOnly | null = null;

  @state() targetElement: Element | null = null;

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.#unobserveSource();
    this.#unobserveTarget();
  }

  override willUpdate(changedProperties: PropertyValues<this>) {
    if (changedProperties.has('source')) {
      this.#unobserveSource();

      if (!this.source) return;

      const vertex = parseVertex(this.source);

      if (vertex) {
        this.sourceRect = DOMRectReadOnly.fromRect(vertex);
      } else {
        const [el] = parseDeepCSSSelector(this.source);

        if (el !== undefined) {
          this.sourceElement = el[0];
          this.#sourceIframeSelector = el[1];
        }
      }
    }

    if (changedProperties.has('sourceElement')) {
      if (this.sourceElement === null) {
        this.sourceRect = null;
      } else {
        folkObserver.observe(this.sourceElement, this.#sourceCallback, { iframeSelector: this.#sourceIframeSelector });
      }
    }

    if (changedProperties.has('target')) {
      this.#unobserveTarget();

      if (!this.target) return;

      const vertex = parseVertex(this.target);

      if (vertex) {
        this.targetRect = DOMRectReadOnly.fromRect(vertex);
      } else {
        const [el] = parseDeepCSSSelector(this.target);

        if (el !== undefined) {
          this.targetElement = el[0];
          this.#targetIframeSelector = el[1];
        }
      }
    }

    if (changedProperties.has('targetElement')) {
      if (this.targetElement === null) {
        this.targetRect = null;
      } else {
        folkObserver.observe(this.targetElement, this.#targetCallback, { iframeSelector: this.#targetIframeSelector });
      }
    }
  }

  #sourceCallback = (entry: ClientRectObserverEntry) => {
    this.sourceRect = entry.contentRect;
  };

  #unobserveSource() {
    if (this.sourceElement === null) return;

    folkObserver.unobserve(this.sourceElement, this.#sourceCallback, { iframeSelector: this.#sourceIframeSelector });
  }

  #targetCallback = (entry: ClientRectObserverEntry) => {
    this.targetRect = entry.contentRect;
  };

  #unobserveTarget() {
    if (this.targetElement === null) return;
    folkObserver.unobserve(this.targetElement, this.#targetCallback, { iframeSelector: this.#targetIframeSelector });
  }
}
