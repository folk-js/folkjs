export type ResizeManagerEntryCallback = (entry: ResizeObserverEntry) => void;

/** A more composition interface to use `ResizeObserver`, allowing the same element to have multiple observers. */
export class ResizeManager {
  #elementMap = new WeakMap<Element, Set<ResizeManagerEntryCallback>>();
  #elementEntry = new WeakMap<Element, ResizeObserverEntry>();

  #vo = new ResizeObserver((entries) => {
    for (const entry of entries) {
      this.#elementEntry.set(entry.target, entry);
      this.#elementMap.get(entry.target)?.forEach((callback) => callback(entry));
    }
  });

  /** Observe the `target` element with `callback`. */
  observe(target: Element, callback: ResizeManagerEntryCallback): void {
    let callbacks = this.#elementMap.get(target);

    if (callbacks === undefined) {
      this.#vo.observe(target);
      this.#elementMap.set(target, (callbacks = new Set()));
    } else {
      const entry = this.#elementEntry.get(target);
      if (entry) {
        callback(entry);
      }
    }

    callbacks.add(callback);
  }

  /** Unobserve the `target` element with `callback`. */
  unobserve(target: Element, callback: ResizeManagerEntryCallback): void {
    const callbacks = this.#elementMap.get(target);

    if (callbacks === undefined) return;

    callbacks.delete(callback);

    if (callbacks.size === 0) {
      this.#vo.unobserve(target);
      this.#elementMap.delete(target);
    }
  }
}
