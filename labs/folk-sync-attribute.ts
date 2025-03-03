import { CustomAttribute, customAttributes } from '@lib';

declare global {
  interface Element {
    sync: FolkSyncAttribute | undefined;
  }
}

Object.defineProperty(Element.prototype, 'sync', {
  get() {
    return customAttributes.get(this, FolkSyncAttribute.attributeName) as FolkSyncAttribute | undefined;
  },
});

export class FolkSyncAttribute extends CustomAttribute {
  static attributeName = 'folk-sync';

  static define() {
    super.define();
  }

  // MutationObserver instance
  #observer: MutationObserver | null = null;

  // Configuration for the MutationObserver
  #observerConfig = {
    attributes: true,
    childList: true,
    characterData: true,
    subtree: true,
    attributeOldValue: true,
    characterDataOldValue: true,
  };

  // Method to start observing mutations
  #startObserving() {
    if (this.#observer) {
      this.#stopObserving();
    }

    this.#observer = new MutationObserver(this.#handleMutations);
    this.#observer.observe(this.ownerElement, this.#observerConfig);
    console.log(`[FolkSync] Started observing mutations on`, this.ownerElement);
  }

  // Method to stop observing mutations
  #stopObserving() {
    if (this.#observer) {
      this.#observer.disconnect();
      this.#observer = null;
      console.log(`[FolkSync] Stopped observing mutations on`, this.ownerElement);
    }
  }

  // Handler for mutations
  #handleMutations = (mutations: MutationRecord[]) => {
    console.log(`[FolkSync] Detected ${mutations.length} mutations:`, mutations);

    for (const mutation of mutations) {
      switch (mutation.type) {
        case 'attributes':
          console.log(`[FolkSync] Attribute '${mutation.attributeName}' changed:`, {
            target: mutation.target,
            oldValue: mutation.oldValue,
            newValue: (mutation.target as Element).getAttribute(mutation.attributeName || ''),
          });
          break;

        case 'characterData':
          console.log(`[FolkSync] Text content changed:`, {
            target: mutation.target,
            oldValue: mutation.oldValue,
            newValue: mutation.target.textContent,
          });
          break;

        case 'childList':
          if (mutation.addedNodes.length > 0) {
            console.log(`[FolkSync] Nodes added:`, mutation.addedNodes);
          }
          if (mutation.removedNodes.length > 0) {
            console.log(`[FolkSync] Nodes removed:`, mutation.removedNodes);
          }
          break;
      }
    }
  };

  connectedCallback(): void {
    console.log(`[FolkSync] Connected to element:`, this.ownerElement);
    this.#startObserving();
  }

  disconnectedCallback(): void {
    console.log(`[FolkSync] Disconnected from element:`, this.ownerElement);
    this.#stopObserving();
  }

  changedCallback(oldValue: string, newValue: string): void {
    console.log(`[FolkSync] Attribute value changed: ${oldValue} -> ${newValue}`);
    // We could implement specific behaviors based on attribute values here
  }
}
