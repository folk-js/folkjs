import { AnyDocumentId, DocHandle, isValidAutomergeUrl, Repo } from '@automerge/automerge-repo';
import { BrowserWebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket';

/**
 * FolkAutomerge provides a simplified interface for working with Automerge documents.
 * It handles document creation, sharing via URL, and synchronization over WebSockets.
 */
export class FolkAutomerge<T> {
  private repo: Repo;
  private handle!: DocHandle<T>;
  private networkAdapter: BrowserWebSocketClientAdapter;

  /**
   * Creates a new FolkAutomerge instance.
   * @param initialState Optional initial state for a new document
   */
  constructor(initialState?: T) {
    const peerId = this.#generatePeerId();

    // Check if there's a valid Automerge URL in the hash
    const hashDocId = window.location.hash.slice(1);
    let docId: string | undefined;

    if (hashDocId && isValidAutomergeUrl(hashDocId)) {
      docId = hashDocId;
    }

    // Set up the WebSocket network adapter
    this.networkAdapter = new BrowserWebSocketClientAdapter('wss://sync.automerge.org');

    // Initialize the repo with network configuration
    this.repo = new Repo({
      peerId: peerId as any,
      network: [this.networkAdapter],
    });

    // Either connect to existing document or create a new one
    if (docId) {
      this.handle = this.repo.find<T>(docId as unknown as AnyDocumentId);

      // Verify document exists or create a new one
      this.whenReady().then(async () => {
        try {
          const doc = await this.handle.doc();
          if (!doc) {
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
   * Creates a new document and updates the URL hash with its ID.
   * @param initialState Optional initial state for the document
   */
  #createNewDocAndUpdateHash(initialState?: T): void {
    this.handle = this.repo.create<T>(initialState as any);

    this.handle.whenReady().then(() => {
      window.location.hash = this.handle.url;
    });
  }

  /**
   * Generates a random peer ID for this client.
   * @returns A unique peer identifier string
   */
  #generatePeerId(): string {
    return `peer-${Math.floor(Math.random() * 1_000_000)}`;
  }

  /**
   * Returns a promise that resolves when the document is ready.
   * @param callback Optional function to call with the document when ready
   * @returns Promise resolving to the document
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
   * Gets the current document's unique identifier.
   * @returns The document URL that can be shared
   */
  getDocumentId(): string {
    return this.handle.url;
  }

  /**
   * Registers a callback to be called whenever the document changes.
   * @param callback Function to call with the updated document
   */
  onChange(callback: (doc: T) => void): void {
    this.handle.on('change', ({ doc }) => {
      if (doc) {
        console.log('FA:onChange');
        callback(doc as T);
      }
    });
  }

  /**
   * Applies changes to the document in a single transaction.
   * @param changeFunc Function that receives the document and can modify it
   */
  change(changeFunc: (doc: T) => void): void {
    this.handle.change((doc: any) => {
      console.log('FA:change');
      changeFunc(doc as T);
      console.log({ doc });
    });
  }
}
