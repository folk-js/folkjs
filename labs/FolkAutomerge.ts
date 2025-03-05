import * as Automerge from '@automerge/automerge';
import { AnyDocumentId, Doc, DocHandle, generateAutomergeUrl, Repo } from '@automerge/automerge-repo';
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb';
import { FolkMultiPeerAdapter, type PeerNetwork } from '@labs/FolkMultiPeerAdapter';

// Define the Todo interface
export interface Todo {
  id: string;
  text: string;
  completed: boolean;
  createdAt: number;
}

// Define the TodoList document interface
export interface TodoListDoc {
  todos: Todo[];
}

/**
 * FolkAutomerge class for managing automerge-repo with local storage
 * Provides methods for creating, reading, updating, and deleting todos
 */
export class FolkAutomerge<T extends TodoListDoc> implements PeerNetwork {
  private repo: Repo;
  private documentId: string = '';
  private handle: DocHandle<T>;
  private onChangesCallback: ((doc: T) => void) | null = null;
  private networkAdapter: FolkMultiPeerAdapter | null = null;

  /**
   * Create a new FolkAutomerge instance
   * @param options - Configuration options for the FolkAutomerge instance
   */
  constructor(options: { peerId?: string; docId?: string }) {
    const peerId = options.peerId || this.#createPeerId();
    // Parse URL params to check for document ID
    const urlParams = new URLSearchParams(window.location.search);
    const urlDocId = urlParams.get('space');

    // Use documentId from URL or from constructor parameter
    let docId = urlDocId || options.docId;

    // If no document ID is provided, create one
    if (!docId) {
      docId = generateAutomergeUrl();
      console.log(`[Network] No document ID provided, created new ID: ${docId}`);
    }

    this.networkAdapter = new FolkMultiPeerAdapter({ peerId: peerId, roomId: docId });

    // Initialize the repo with proper configuration
    this.repo = new Repo({
      peerId: peerId as any, // Use the same peerId consistently
      storage: new IndexedDBStorageAdapter(),
      network: [this.networkAdapter],
    });

    // Add listener for peer connections
    if (this.networkAdapter) {
      // Log when adapter is ready
      this.networkAdapter.on('ready', () => {
        console.log('[FolkAutomerge] Network adapter is ready');
      });

      // Add debug for sync messages
      this.networkAdapter.on('message', (message) => {
        console.log('[FolkAutomerge] Network message received:', {
          type: message.type,
          hasData: 'data' in message && !!message.data,
          dataLength: 'data' in message && message.data ? message.data.byteLength : 0,
        });
      });

      // Monitor peer candidates
      this.networkAdapter.on('peer-candidate', (info) => {
        console.log('[FolkAutomerge] Peer candidate:', info);
      });
    }

    // Try to load document ID from URL or create a new one if not provided
    if (urlDocId) {
      console.log(`[Doc] Loading shared document from URL: ${urlDocId}`);
      this.documentId = urlDocId;
    } else if (docId) {
      this.documentId = docId;
    }

    // Find the document
    try {
      // Try to load the document with proper error handling
      this.handle = this.repo.find<T>(this.documentId as unknown as AnyDocumentId);

      // Set up change handler early so we can catch initialization
      this.handle.on('change', () => {
        if (this.onChangesCallback) {
          const doc = this.handle.docSync();
          if (doc) {
            this.onChangesCallback(doc);
          }
        }
      });
    } catch (error) {
      console.error('Error finding document:', error);

      // If there's an IndexedDB error, we might need to create a new document
      try {
        // Create a new document with the specified ID
        this.handle = this.repo.create<T>();
        // Update the document ID
        this.documentId = this.handle.documentId;
        console.log(`[Doc] Created new document with ID: ${this.documentId}`);

        // Set up change handler
        this.handle.on('change', () => {
          if (this.onChangesCallback) {
            const doc = this.handle.docSync();
            if (doc) {
              this.onChangesCallback(doc);
            }
          }
        });
      } catch (createError) {
        console.error('Error creating document:', createError);
        throw createError; // Re-throw if we can't recover
      }
    }

    // Initialize the document with empty todos array if it doesn't exist
    this.handle.update((doc: Doc<T>) => {
      if (!doc.todos) {
        return Automerge.change(doc, (d: any) => {
          d.todos = [];
        });
      }
      return doc;
    });
  }

  #createPeerId(): string {
    return `peer-${Math.floor(Math.random() * 1_000_000)}`;
  }

  /**
   * Clean up resources when this instance is no longer needed
   */
  public dispose(): void {
    if (this.networkAdapter) {
      this.networkAdapter.disconnect();
    }
  }

  onPeersChanged(listener: (peers: string[]) => void): void {
    this.networkAdapter?.onPeersChanged(listener);
  }

  getPeers(): string[] {
    return this.networkAdapter?.getPeers() || [];
  }

  /**
   * Get the current state of the document
   */
  getDocument(): T {
    const doc = this.handle.docSync();
    if (!doc) {
      return { todos: [] } as unknown as T;
    }
    return doc;
  }

  /**
   * Get the document ID
   */
  getDocumentId(): string {
    return this.documentId;
  }

  /**
   * Register a callback to be called when the document changes
   */
  onChange(callback: (doc: T) => void): void {
    this.onChangesCallback = callback;

    // Immediately call the callback with the current document
    const doc = this.handle.docSync();
    if (doc) {
      callback(doc);
    }
  }

  /**
   * Generate a shareable URL for this document
   */
  generateShareableUrl(baseUrl: string = window.location.href): string {
    console.log(`[Doc] Generating shareable URL for document: ${this.documentId}`);
    // Fallback to simple URL generation if no network adapter
    const url = new URL(baseUrl);
    url.searchParams.set('space', this.documentId);
    return url.toString();
  }

  /**
   * Add a new todo item
   */
  addTodo(text: string): void {
    this.handle.update((doc: Doc<T>) => {
      return Automerge.change(doc, (d) => {
        d.todos.push({
          id: crypto.randomUUID(),
          text,
          completed: false,
          createdAt: Date.now(),
        });
      });
    });
  }

  /**
   * Toggle the completed status of a todo
   */
  toggleTodo(id: string): void {
    this.handle.update((doc: Doc<T>) => {
      return Automerge.change(doc, (d) => {
        const todo = d.todos.find((t) => t.id === id);
        if (todo) {
          todo.completed = !todo.completed;
        }
      });
    });
  }

  /**
   * Edit a todo's text
   */
  editTodo(id: string, newText: string): void {
    this.handle.update((doc: Doc<T>) => {
      return Automerge.change(doc, (d) => {
        const todo = d.todos.find((t) => t.id === id);
        if (todo) {
          todo.text = newText;
        }
      });
    });
  }

  /**
   * Delete a todo
   */
  deleteTodo(id: string): void {
    this.handle.update((doc: Doc<T>) => {
      return Automerge.change(doc, (d) => {
        const index = d.todos.findIndex((t) => t.id === id);
        if (index !== -1) {
          d.todos.splice(index, 1);
        }
      });
    });
  }

  /**
   * Clear all completed todos
   */
  clearCompleted(): void {
    this.handle.update((doc: Doc<T>) => {
      return Automerge.change(doc, (d) => {
        // Remove all todos that are completed
        d.todos = d.todos.filter((todo) => !todo.completed);
      });
    });
  }
}
