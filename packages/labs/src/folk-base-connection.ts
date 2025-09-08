import { type ClientRectObserverEntry } from '@folkjs/dom/ClientRectObserver';
import {
  property,
  ReactiveElement,
  state,
  type ComplexAttributeConverter,
  type PropertyValues,
} from '@folkjs/dom/ReactiveElement';
import { findCssSelector } from '@folkjs/dom/css-selector';
import { decodeRange, encodeRange } from '@folkjs/dom/range';
import { type Point, type Vector2 } from '@folkjs/geometry/Vector2';
import { toDOMPrecision } from '@folkjs/geometry/utilities';
import { FolkObserver } from './folk-observer';

const pointRegex = /\:\:point\((?<x>-?([0-9]*[.])?[0-9]+),\s*(?<y>-?([0-9]*[.])?[0-9]+)\)/;

export function decodePointFromPseudoElement(str: string): Vector2 | null {
  const results = pointRegex.exec(str);

  if (results === null || results.groups === undefined) return null;

  const { x, y } = results.groups;

  return {
    x: Number(x),
    y: Number(y),
  };
}

function encodePoint(v: Point): string {
  return `::point(${toDOMPrecision(v.x)}, ${toDOMPrecision(v.y)})`;
}

const folkObserver = new FolkObserver();

type SelectorValue = Element | Range | Point | null;

const converter: ComplexAttributeConverter<SelectorValue> = {
  fromAttribute(value) {
    if (value === null) return null;

    const point = decodePointFromPseudoElement(value);
    if (point) return point;

    const range = decodeRange(value);
    if (range) return range;

    return document.querySelector(value);
  },
  toAttribute(value) {
    if (value === null) return '';
    else if (value instanceof Element) return findCssSelector(value);
    else if (value instanceof Range) return encodeRange(value);
    else return encodePoint(value);
  },
};

// TODO really need to rethink this
export class FolkBaseConnection extends ReactiveElement {
  @property({ reflect: true, converter }) source: SelectorValue = null;

  @state() sourceRect: DOMRectReadOnly | null = null;

  @property({ reflect: true, converter }) target: SelectorValue = null;

  @state() targetRect: DOMRectReadOnly | null = null;

  override disconnectedCallback() {
    super.disconnectedCallback();

    this.#unobserve(this.source, this.#sourceCallback);
    this.#unobserve(this.target, this.#targetCallback);
  }

  override willUpdate(changedProperties: PropertyValues<this>) {
    if (changedProperties.has('source')) {
      const oldSource = changedProperties.get('source') || null;

      this.#unobserve(oldSource, this.#sourceCallback);
      this.#observe(this.source, this.#sourceCallback);
    }

    if (changedProperties.has('target')) {
      const oldTarget = changedProperties.get('target') || null;

      this.#unobserve(oldTarget, this.#targetCallback);
      this.#observe(this.target, this.#targetCallback);
    }
  }

  #observe(value: SelectorValue, callback: (entry: ClientRectObserverEntry) => void) {
    if (value === null) return;

    if (value instanceof Element) {
      folkObserver.observe(value, callback);
    } else if (value instanceof Range) {
      folkObserver.observe(value.commonAncestorContainer as Element, callback);
    } else {
      callback({ target: this, contentRect: new DOMRectReadOnly(value.x, value.y, 0, 0) });
    }
  }

  #unobserve(value: SelectorValue, callback: (entry: ClientRectObserverEntry) => void) {
    const oldElement =
      value instanceof Element ? value : value instanceof Range ? (value.commonAncestorContainer as Element) : null;

    if (oldElement !== null) {
      folkObserver.unobserve(oldElement, callback);
    }
  }

  #sourceCallback = (entry: ClientRectObserverEntry) => {
    this.sourceRect = entry.contentRect;
  };

  #targetCallback = (entry: ClientRectObserverEntry) => {
    this.targetRect = entry.contentRect;
  };
}
