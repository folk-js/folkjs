import { FolkObserver, parseDeepCSSSelector } from '@folkjs/labs/folk-observer';
import { type ClientRectObserverEntry, FolkElement } from '@folkjs/canvas';
import { css, type CSSResultGroup, property, type PropertyValues, state } from '@folkjs/canvas/reactive-element';

const folkObserver = new FolkObserver();

// TODO: use mutation observer to track the addition an removal of elements
export class FolkBaseHyperedge extends FolkElement {
  static override styles: CSSResultGroup = css`
    :host {
      display: block;
      position: absolute;
      inset: 0;
      pointer-events: none;
    }

    ::slotted(*) {
      pointer-events: auto;
    }
  `;

  @property({ reflect: true }) sources?: string;
  @property({ reflect: true }) targets?: string;

  #sourcesMap = new Map<Element, DOMRectReadOnly>();
  #targetsMap = new Map<Element, DOMRectReadOnly>();
  get sourcesMap(): ReadonlyMap<Element, DOMRectReadOnly> {
    return this.#sourcesMap;
  }
  get targetsMap(): ReadonlyMap<Element, DOMRectReadOnly> {
    return this.#targetsMap;
  }

  get sourceRects() {
    return Array.from(this.#sourcesMap.values());
  }
  get targetRects() {
    return Array.from(this.#targetsMap.values());
  }

  @state() sourceElements = new Set<Element>();
  @state() targetElements = new Set<Element>();

  override createRenderRoot() {
    const root = super.createRenderRoot();

    return root;
  }

  override willUpdate(changedProperties: PropertyValues<this>) {
    if (changedProperties.has('sources')) {
      this.#observeSources();
    }
    if (changedProperties.has('targets')) {
      this.#observeTargets();
    }
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.unobserveSources();
    this.unobserveTargets();
  }

  #observeSources() {
    const elements = this.sources ? parseDeepCSSSelector(this.sources) : [];
    const elementsMap = new Map(elements);
    const sourceElements = new Set(elements.map((el) => el[0]));
    const elementsToObserve = sourceElements.difference(this.sourceElements);
    const elementsToUnobserve = this.sourceElements.difference(sourceElements);

    this.unobserveSources(elementsToUnobserve);

    for (const el of elementsToObserve) {
      folkObserver.observe(el, this.#sourcesCallback, { iframeSelector: elementsMap.get(el) });
    }

    this.sourceElements = sourceElements;
  }
  #observeTargets() {
    const elements = this.targets ? parseDeepCSSSelector(this.targets) : [];
    const elementsMap = new Map(elements);
    const targetElements = new Set(elements.map((el) => el[0]));
    const elementsToObserve = targetElements.difference(this.targetElements);
    const elementsToUnobserve = this.targetElements.difference(targetElements);

    this.unobserveTargets(elementsToUnobserve);

    for (const el of elementsToObserve) {
      folkObserver.observe(el, this.#targetsCallback, { iframeSelector: elementsMap.get(el) });
    }

    this.targetElements = targetElements;
  }

  #sourcesCallback = (entry: ClientRectObserverEntry) => {
    this.#sourcesMap.set(entry.target, entry.contentRect);
    this.requestUpdate('sourcesMap');
  };
  #targetsCallback = (entry: ClientRectObserverEntry) => {
    this.#targetsMap.set(entry.target, entry.contentRect);
    this.requestUpdate('targetsMap');
  };

  unobserveSources(elements: Set<Element> = this.sourceElements) {
    for (const el of elements) {
      folkObserver.unobserve(el, this.#sourcesCallback);
      this.#sourcesMap.delete(el);
      this.sourceElements.delete(el);
    }
  }
  unobserveTargets(elements: Set<Element> = this.sourceElements) {
    for (const el of elements) {
      folkObserver.unobserve(el, this.#targetsCallback);
      this.#targetsMap.delete(el);
      this.targetElements.delete(el);
    }
  }
}
