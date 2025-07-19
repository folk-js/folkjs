import { type ClientRectObserverEntry } from '@folkjs/dom/ClientRectObserver';
import {
  ReactiveElement,
  css,
  property,
  state,
  type CSSResultGroup,
  type PropertyValues,
} from '@folkjs/dom/ReactiveElement';
import { FolkObserver, parseDeepCSSSelector } from './folk-observer';

const folkObserver = new FolkObserver();

// TODO: use mutation observer to track the addition an removal of elements
export class FolkBaseSet extends ReactiveElement {
  static override styles: CSSResultGroup = css`
    :host {
      display: block;
      position: absolute;
      inset: 0;
      pointer-events: none;
    }

    ::slotted(*) {
      pointer-events: auto;
      z-index: 1;
    }
  `;

  @property({ reflect: true }) sources?: string;

  #sourcesMap = new Map<Element, DOMRectReadOnly>();
  get sourcesMap(): ReadonlyMap<Element, DOMRectReadOnly> {
    return this.#sourcesMap;
  }

  get sourceRects() {
    return Array.from(this.#sourcesMap.values());
  }

  @state() sourceElements: ReadonlySet<Element> = new Set<Element>();

  #slot = document.createElement('slot');

  override createRenderRoot() {
    const root = super.createRenderRoot();

    root.append(this.#slot);

    this.#slot.addEventListener('slotchange', this.#onSlotchange);

    return root;
  }

  override willUpdate(changedProperties: PropertyValues<this>) {
    if (changedProperties.has('sources')) {
      this.#observeSources();
    }
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.#unobserveSources(this.sourceElements as Set<Element>);
  }

  // we might not need to react to the first slot change
  #onSlotchange = () => this.#observeSources();

  #observeSources() {
    const childElements = new Set(this.children);
    const elements = this.sources ? parseDeepCSSSelector(this.sources) : [];
    const elementsMap = new Map(elements);
    const sourceElements = new Set(elements.map((el) => el[0])).union(childElements);
    const elementsToObserve = sourceElements.difference(this.sourceElements);
    const elementsToUnobserve = this.sourceElements.difference(sourceElements);

    this.#unobserveSources(elementsToUnobserve);

    for (const el of elementsToObserve) {
      folkObserver.observe(el, this.#sourcesCallback, { iframeSelector: elementsMap.get(el) });
    }

    this.sourceElements = sourceElements;
  }

  #sourcesCallback = (entry: ClientRectObserverEntry) => {
    this.#sourcesMap.set(entry.target, entry.contentRect);
    this.requestUpdate('sourcesMap');
  };

  #unobserveSources(elements: Set<Element>) {
    for (const el of elements) {
      this.#sourcesMap.delete(el);
      (this.sourceElements as Set<Element>).delete(el);
      folkObserver.unobserve(el, this.#sourcesCallback);
    }
  }

  addElement(element: Element) {
    if (this.sourceElements.has(element)) return;
    const set = new Set<Element>();
    set.add(element);
    this.sourceElements.forEach((el) => set.add(el));
    this.sourceElements = set;
  }

  removeElement(element: Element) {
    if (!this.sourceElements.has(element)) return;

    const set = new Set<Element>();
    this.sourceElements.forEach((el) => {
      if (el !== element) set.add(el);
    });
    this.sourceElements = set;
  }
}
