import { proximal } from '@folkjs/geometry/Rect2D';
import { FolkHull } from './folk-hull';
import { FolkShape } from './folk-shape';

interface ElementConstructor<E extends Element = Element> {
  new (): E;
}

export interface ElementConfig<E extends Element = Element> {
  constructor: ElementConstructor<E>;
  events?: Record<string, (event: Event) => Record<string, any>>;
  onAdd?(element: E): void | Record<string, any>;
  onUpdate?(element: E, data: ReadonlyMap<string, any>, updatedValues: Set<string>): void;
  onRemove?(element: E): void;
}

// TODO don't hard code this
const PROXIMITY = 125;

declare global {
  interface HTMLElementTagNameMap {
    'folk-cluster': FolkCluster;
    'folk-proximity': FolkProximity;
  }
}

export class FolkCluster extends FolkHull {
  static override tagName = 'folk-cluster';

  static #config = new Map<ElementConstructor, ElementConfig>();

  static registerElement<E extends Element>(config: ElementConfig<E>) {
    this.#config.set(config.constructor, config);
  }

  #data = new Map();

  isElementInCluster(element: FolkShape) {
    return this.sourceElements.has(element);
  }

  isElementInProximity(element: FolkShape) {
    for (const el of this.sourceElements) {
      if (proximal(el as FolkShape, element, PROXIMITY)) {
        return true;
      }
    }
    return false;
  }

  addElements(...elements: FolkShape[]) {
    const elementsSet = new Set(elements);
    const newElements = elementsSet.difference(this.sourceElements);
    this.sourceElements = this.sourceElements.union(elementsSet);

    let data = {};

    for (const geometry of newElements) {
      const element = geometry.firstElementChild;

      if (element === null) continue;

      const config = this.#getConfig(element);

      if (config) {
        for (const event of Object.keys(config.events || {})) {
          element.addEventListener(event, this.#handleEvent);
        }
        const newData = config.onAdd?.(element);
        data = Object.assign(data, newData);
      }
    }

    this.#handleUpdate(data);
  }

  #handleEvent = (event: Event) => {
    const config = this.#getConfig(event.currentTarget as Element);

    if (config) {
      const data = config.events?.[event.type]?.(event);
      if (data === undefined) return;
      this.#handleUpdate(data);
    }
  };

  #handleUpdate(data: Record<string, any>) {
    const keys = new Set(Object.keys(data));
    for (const key of keys) {
      this.#data.set(key, data[key]);
    }

    for (const geometry of this.sourceElements) {
      const element = geometry.firstElementChild;

      if (element === null) continue;

      const config = this.#getConfig(element);

      config?.onUpdate?.(element, this.#data, keys);
    }
  }

  override removeElement(geometry: FolkShape) {
    super.removeElement(geometry);

    const element = geometry.firstElementChild;

    if (element === null) return;

    const config = this.#getConfig(element);

    if (config) {
      for (const event of Object.keys(config.events || {})) {
        element.removeEventListener(event, this.#handleEvent);
      }

      config.onRemove?.(element);
    }
  }

  #getConfig(element: Element) {
    const config = (this.constructor as typeof FolkCluster).#config;
    return config.get(element.constructor as ElementConstructor);
  }
}

export class FolkProximity extends HTMLElement {
  static tagName = 'folk-proximity';

  static define() {
    if (customElements.get(this.tagName)) return;
    FolkCluster.define();
    customElements.define(this.tagName, this);
    FolkShape.define();
  }

  #clusters = new Set<FolkCluster>();

  constructor() {
    super();

    this.addEventListener('transform', this.#handleProximity);
  }

  #handleProximity = (e: Event) => {
    const el = e.target as FolkShape;

    const cluster = this.#findCluster(el);

    if (cluster === null) {
      for (const cluster of this.#clusters) {
        // what if its in proximity to multiple clusters?
        if (cluster.isElementInProximity(el)) {
          cluster.addElements(el);
          return;
        }
      }

      // The shape is not in a cluster so create a new one.
      const cluster = document.createElement('folk-cluster');
      cluster.addElements(el);
      this.#clusters.add(cluster);
      this.appendChild(cluster);
    } else {
      const isInCluster = Array.from(cluster.sourceElements)
        .filter((element) => el !== element)
        .some((element) => proximal(el, element as FolkShape, PROXIMITY));

      if (!isInCluster) {
        cluster.removeElement(el);

        if (cluster.sourcesMap.size === 1) {
          this.#clusters.delete(cluster);
          cluster.remove();
        }
      }
    }
  };

  #findCluster(element: FolkShape) {
    for (const cluster of this.#clusters) {
      if (cluster.isElementInCluster(element)) return cluster;
    }
    return null;
  }
}
