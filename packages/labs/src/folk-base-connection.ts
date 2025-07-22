import { type ClientRectObserverEntry } from '@folkjs/dom/ClientRectObserver';
import {
  css,
  type CSSResultGroup,
  property,
  type PropertyValues,
  ReactiveElement,
  state,
} from '@folkjs/dom/ReactiveElement';
import type { Point, Vector2 } from '@folkjs/geometry/Vector2';
import { FolkObserver, parseDeepCSSSelector } from './folk-observer';

const vertexRegex = /\:\:point\((?<x>-?([0-9]*[.])?[0-9]+),\s*(?<y>-?([0-9]*[.])?[0-9]+)\)/;

export function decodePointToPseudoElement(str: string): Vector2 | null {
  const results = vertexRegex.exec(str);

  if (results === null || results.groups === undefined) return null;

  const { x, y } = results.groups;

  return {
    x: Number(x),
    y: Number(y),
  };
}

export function encodeToPseudoElement(v: Point): string {
  return `::point(${v.x}, ${v.y})`;
}

const folkObserver = new FolkObserver();

export class FolkBaseConnection extends ReactiveElement {
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

  @state() sourceRange: Range | null = null;

  @state() sourcePoint: Point | null = null;

  @state() sourceRect: DOMRectReadOnly | null = null;

  @property({ reflect: true }) target?: string;

  #targetIframeSelector: string | undefined = undefined;

  @state() targetElement: Element | null = null;

  @state() targetRange: Range | null = null;

  @state() targetPoint: Point | null = null;

  @state() targetRect: DOMRectReadOnly | null = null;

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.#unobserveSource();
    this.#unobserveTarget();
  }

  override willUpdate(changedProperties: PropertyValues<this>) {
    if (changedProperties.has('source')) {
      this.#unobserveSource();

      if (!this.source) return;

      const point = decodePointToPseudoElement(this.source);

      if (point) {
        this.sourcePoint = point;
        this.sourceRect = DOMRectReadOnly.fromRect(point);
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
        if (changedProperties.has('source')) this.source = '';
        folkObserver.observe(this.sourceElement, this.#sourceCallback, { iframeSelector: this.#sourceIframeSelector });
      }
    }

    if (changedProperties.has('sourcePoint') && this.sourcePoint) {
      this.sourceRect = DOMRectReadOnly.fromRect(this.sourcePoint);
      this.source = `${this.sourcePoint.x},${this.sourcePoint.y}`;
    }

    if (changedProperties.has('target')) {
      this.#unobserveTarget();

      if (!this.target) return;

      const point = decodePointToPseudoElement(this.target);

      if (point) {
        this.targetPoint = point;
        this.targetRect = DOMRectReadOnly.fromRect(point);
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
        if (changedProperties.has('target')) this.target = '';
        folkObserver.observe(this.targetElement, this.#targetCallback, { iframeSelector: this.#targetIframeSelector });
      }
    }

    if (changedProperties.has('targetPoint') && this.targetPoint) {
      this.targetRect = DOMRectReadOnly.fromRect(this.targetPoint);
      this.target = `${this.targetPoint.x},${this.targetPoint.y}`;
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
