import { FolkShape } from '@folkjs/labs/folk-shape';
import { ClientRectObserver, type ClientRectObserverEntry } from '@folkjs/lib/client-rect-observer';
import { TransformEvent } from '@folkjs/lib/TransformEvent';

export type FolkObserverEntry = (entry: ClientRectObserverEntry) => void;

export type FolkObserverOptions = {
  iframeSelector?: string;
};

interface IframeChild {
  rect: DOMRectReadOnly | null;
  callbacks: Set<FolkObserverEntry>;
}

type PostMessageSendEvent =
  | { type: 'folk-observe-element'; selector: string }
  | { type: 'folk-unobserve-element'; selector: string };

class IframeObserver {
  #iframe;
  #observer;
  #iframeRect!: DOMRectReadOnly;
  #iframeChildren = new Map<string, IframeChild>();
  #isDisposed = false;

  get isDisposed() {
    return this.#isDisposed;
  }

  constructor(iframe: HTMLIFrameElement, observer: FolkObserver) {
    this.#iframe = iframe;
    this.#observer = observer;

    observer.observe(iframe, this.#iframeCallback);
    window.addEventListener('message', this.#onPostmessage);
  }

  observeChild(selector: string, callback: FolkObserverEntry) {
    let child = this.#iframeChildren.get(selector);

    if (child === undefined) {
      child = {
        callbacks: new Set(),
        rect: null,
      };

      this.#iframeChildren.set(selector, child);

      this.#postMessage({ type: 'folk-observe-element', selector });
    }

    child.callbacks.add(callback);
  }

  unobserveChild(selector: string, callback: FolkObserverEntry) {
    let child = this.#iframeChildren.get(selector);

    if (child === undefined) return;

    child.callbacks.delete(callback);

    if (child.callbacks.size === 0) {
      this.#iframeChildren.delete(selector);
      this.#postMessage({ type: 'folk-unobserve-element', selector });
    }

    if (this.#iframeChildren.size === 0) {
      this.#observer.unobserve(this.#iframe, this.#iframeCallback);
      window.removeEventListener('message', this.#onPostmessage);
      this.#isDisposed = true;
    }
  }

  #iframeCallback = (entry: ClientRectObserverEntry) => {
    this.#iframeRect = entry.contentRect;

    for (const selector of this.#iframeChildren.keys()) {
      this.#updatedChildRect(selector);
    }
  };

  #onPostmessage = (event: MessageEvent) => {
    if (event.source !== this.#iframe.contentWindow) return;

    switch (event.data.type) {
      case 'folk-iframe-ready': {
        for (const selector of this.#iframeChildren.keys()) {
          this.#postMessage({ type: 'folk-observe-element', selector });
        }
        return;
      }
      case 'folk-element-change': {
        this.#updatedChildRect(event.data.selector, event.data.contentRect);
        return;
      }
    }
  };

  #updatedChildRect(selector: string, rect?: DOMRectReadOnly) {
    const child = this.#iframeChildren.get(selector);

    if (child === undefined) return;

    if (rect) {
      child.rect = rect;
    }

    if (child.rect === null) return;

    const contentRect = DOMRectReadOnly.fromRect({
      x: this.#iframeRect.x + child.rect.x,
      y: this.#iframeRect.y + child.rect.y,
      height: child.rect.height,
      width: child.rect.width,
    });

    child.callbacks.forEach((callback) =>
      callback({
        target: this.#iframe,
        contentRect,
      }),
    );
  }

  #postMessage(event: PostMessageSendEvent) {
    this.#iframe.contentWindow?.postMessage(event);
  }
}

export class FolkObserver {
  static #instance: FolkObserver | null = null;

  // singleton so we only observe elements once
  constructor() {
    if (FolkObserver.#instance === null) {
      FolkObserver.#instance = this;
    }
    return FolkObserver.#instance;
  }

  #elementMap = new WeakMap<Element, Set<FolkObserverEntry>>();
  #iframeMap = new WeakMap<HTMLIFrameElement, IframeObserver>();

  #vo = new ClientRectObserver((entries) => {
    for (const entry of entries) {
      this.#updateTarget(entry);
    }
  });

  #updateTarget(entry: ClientRectObserverEntry) {
    const callbacks = this.#elementMap.get(entry.target);

    if (callbacks) {
      callbacks.forEach((callback) => callback(entry));
    }
  }

  #onTransform = (event: TransformEvent) => {
    this.#updateTarget({ target: event.target as HTMLElement, contentRect: event.current });
  };

  observe(target: Element, callback: FolkObserverEntry, { iframeSelector }: FolkObserverOptions = {}): void {
    if (target instanceof HTMLIFrameElement && iframeSelector) {
      let iframeObserver = this.#iframeMap.get(target);

      if (iframeObserver === undefined) {
        iframeObserver = new IframeObserver(target, this);
        this.#iframeMap.set(target, iframeObserver);
      }

      iframeObserver.observeChild(iframeSelector, callback);

      return;
    }

    let callbacks = this.#elementMap.get(target);

    if (callbacks === undefined) {
      this.#elementMap.set(target, (callbacks = new Set()));

      if (target instanceof FolkShape) {
        target.addEventListener('transform', this.#onTransform);
        callback({ target, contentRect: target.getTransformDOMRect() });
      } else {
        this.#vo.observe(target);
      }
    } else {
      const contentRect = target instanceof FolkShape ? target.getTransformDOMRect() : target.getBoundingClientRect();
      callback({ target, contentRect });
    }

    callbacks.add(callback);
  }

  unobserve(target: Element, callback: FolkObserverEntry, { iframeSelector }: FolkObserverOptions = {}): void {
    if (target instanceof HTMLIFrameElement && iframeSelector) {
      let iframeObserver = this.#iframeMap.get(target);

      if (iframeObserver === undefined) return;

      iframeObserver.unobserveChild(iframeSelector, callback);

      if (iframeObserver.isDisposed) {
        this.#iframeMap.delete(target);
      }

      return;
    }

    let callbacks = this.#elementMap.get(target);

    if (callbacks === undefined) return;

    callbacks.delete(callback);

    if (callbacks.size === 0) {
      if (target instanceof FolkShape) {
        target.removeEventListener('transform', this.#onTransform);
      } else {
        this.#vo.unobserve(target);
      }
      this.#elementMap.delete(target);
    }
  }
}

const regex = /(.*iframe.*)\s+(.*)/;

export function parseDeepCSSSelector(selectorList: string): [Element, string | undefined][] {
  const array: [Element, string | undefined][] = [];

  for (const selector of selectorList.split(/,(?![^()]*\))/g)) {
    const [, elementSelector, iframeSelector] = regex.exec(selector) || [undefined, selector, undefined];

    document.querySelectorAll(elementSelector).forEach((el) => {
      array.push([el, iframeSelector]);
    });
  }

  return array;
}
