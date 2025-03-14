import { CustomAttribute } from '@lib';
import { FolkAutomerge } from './FolkAutomerge';

export class FolkSyncAttribute extends CustomAttribute {
  static attributeName = 'folk-sync';

  // The FolkAutomerge instance for network sync
  #automerge: FolkAutomerge<any> | null = null;

  // MutationObserver instance
  #observer: MutationObserver | null = null;

  // Define the custom attribute
  static define() {
    console.log('Defining FolkSyncAttribute');
    super.define();
  }

  /**
   * Start observing DOM mutations
   */
  #startObserving(): void {
    if (!this.#observer) {
      this.#observer = new MutationObserver((mutations) => {
        console.log('Mutations detected:', mutations);
        // We'll implement mutation handling later
      });
    }

    this.#observer.observe(this.ownerElement, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
      attributeOldValue: true,
      characterDataOldValue: true,
    });

    console.log('Started observing DOM mutations');
  }

  /**
   * Stop observing DOM mutations
   */
  #stopObserving(): void {
    if (this.#observer) {
      this.#observer.disconnect();
    }
  }

  /**
   * Initialize when the attribute is connected to the DOM
   */
  connectedCallback(): void {
    console.log(`FolkSync connected to <${this.ownerElement.tagName.toLowerCase()}>`);

    // Initialize FolkAutomerge for network sync
    this.#automerge = new FolkAutomerge<any>({});

    // Start observing mutations
    this.#startObserving();

    console.log('FolkSync initialized with document ID:', this.#automerge.getDocumentId());
  }

  /**
   * Clean up when the attribute is removed from the DOM
   */
  disconnectedCallback(): void {
    console.log(`FolkSync disconnected from <${this.ownerElement.tagName.toLowerCase()}>`);

    // Stop observing mutations
    this.#stopObserving();
  }
}

FolkSyncAttribute.define();
