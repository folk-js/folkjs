import { AnyDocumentId, DocHandle, isValidAutomergeUrl, Repo } from '@automerge/automerge-repo';
import { BrowserWebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket';

export class FolkAutomerge<T> {
  private repo: Repo;
  private handle!: DocHandle<T>;
  private networkAdapter: BrowserWebSocketClientAdapter;

  constructor(initialState?: T) {
    const peerId = this.#createPeerId();

    // Check if there's a valid Automerge URL in the hash
    const hashDocId = window.location.hash.slice(1); // Remove the # character
    let docId: string | undefined;

    if (hashDocId && isValidAutomergeUrl(hashDocId)) {
      docId = hashDocId;
    }

    // Set up the WebSocket network adapter
    this.networkAdapter = new BrowserWebSocketClientAdapter('wss://sync.automerge.org');

    // Initialize the repo with proper configuration
    this.repo = new Repo({
      peerId: peerId as any,
      network: [this.networkAdapter],
    });

    // Find or create the document
    if (docId) {
      this.handle = this.repo.find<T>(docId as unknown as AnyDocumentId);

      // Check if we can actually find the document
      this.whenReady().then(async () => {
        try {
          const doc = await this.handle.doc();
          if (!doc) {
            // If doc not found, create a new one and update hash
            this.#createNewDocAndUpdateHash(initialState);
          }
        } catch (error) {
          console.error('Error finding document:', error);
          this.#createNewDocAndUpdateHash(initialState);
        }
      });
    } else {
      this.#createNewDocAndUpdateHash(initialState);
    }
  }

  /**
   * Create a new document and update the URL hash
   */
  #createNewDocAndUpdateHash(initialState?: T): void {
    // Create a new document with initial state
    this.handle = this.repo.create<T>(initialState as any);

    // Update the URL hash with the new document ID
    this.handle.whenReady().then(() => {
      window.location.hash = this.handle.url;
    });
  }

  #createPeerId(): string {
    return `peer-${Math.floor(Math.random() * 1_000_000)}`;
  }

  /**
   * Returns a promise that resolves when the document is ready
   * Can also take an optional callback that will be called with the document when ready
   */
  async whenReady(callback?: (doc: T) => void): Promise<T> {
    await this.handle.whenReady();
    const doc = await this.handle.doc();
    const result = doc as T;

    if (callback) {
      callback(result);
    }

    return result;
  }

  /**
   * Get the document ID
   */
  getDocumentId(): string {
    return this.handle.url;
  }

  /**
   * Register a callback to be called when the document changes
   */
  onChange(callback: (doc: T) => void): void {
    // Use the 'change' event to get document updates
    this.handle.on('change', ({ doc }) => {
      if (doc) {
        callback(doc as T);
      }
    });
  }

  /**
   * Convenience method to make changes to the document
   */
  change(changeFunc: (doc: T) => void): void {
    this.handle.change((doc: any) => {
      changeFunc(doc as T);
    });
  }
}
