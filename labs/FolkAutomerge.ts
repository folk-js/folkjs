import * as Automerge from '@automerge/automerge';
import { Doc, DocHandle, Repo } from '@automerge/automerge-repo';
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb';
import { AutomergeRTCAdapter } from '@labs/AutomergeRTCAdapter';

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
export class FolkAutomerge {
  private repo: Repo;
  private documentId: string;
  private handle: DocHandle<TodoListDoc>;
  private onChangesCallback: ((doc: TodoListDoc) => void) | null = null;
  private localStorageKey: string;
  private networkAdapter: AutomergeRTCAdapter | null = null;
  private onPeerConnectionCallback: ((count: number) => void) | null = null;

  /**
   * Create a new FolkAutomerge instance
   * @param storageId - Identifier for the storage (used for indexedDB)
   * @param documentId - Optional document ID, if not provided a new one will be created or loaded from localStorage
   */
  constructor(storageId: string, documentId?: string) {
    this.localStorageKey = `folk-automerge-docid-${storageId}`;

    // Parse URL params to check for document ID
    const urlParams = new URLSearchParams(window.location.search);
    const urlDocId = urlParams.get('doc');

    // Use documentId from URL or from constructor parameter
    let effectiveDocId = urlDocId || documentId;

    // If no document ID is provided, create one
    if (!effectiveDocId) {
      effectiveDocId = `doc-${Math.floor(Math.random() * 1000000)}`;
      console.log(`[Network] No document ID provided, created new ID: ${effectiveDocId}`);
    }

    // Generate a peer ID for this instance
    const peerId = `peer-${Math.floor(Math.random() * 1000000)}`;

    // Initialize network adapter with the document ID as the room ID
    console.log(`[Network] Initializing network adapter with document ID: ${effectiveDocId}`);
    this.networkAdapter = new AutomergeRTCAdapter({ roomId: effectiveDocId });

    // Add listener for peer connections
    this.networkAdapter.addConnectionStatusListener((peerId, connected) => {
      if (this.onPeerConnectionCallback) {
        this.onPeerConnectionCallback(this.networkAdapter?.getConnectedPeers().length || 0);
      }
    });

    // Initialize the automerge repo with network adapters
    const repoConfig: any = {
      peerId: peerId as any,
      network: [this.networkAdapter],
    };

    // Initialize the repo
    this.repo = new Repo(repoConfig);

    // Try to load document ID from URL or localStorage if not provided
    if (urlDocId) {
      console.log(`[Doc] Loading shared document from URL: ${urlDocId}`);
      documentId = urlDocId;
      localStorage.setItem(this.localStorageKey, urlDocId);
    } else {
      // Try to load document ID from localStorage if not provided
      const savedDocId = !documentId && localStorage.getItem(this.localStorageKey);

      if (savedDocId) {
        // Use the saved document ID
        console.log(`[Doc] Loading existing document: ${savedDocId}`);
        documentId = savedDocId;
      } else if (!documentId) {
        // Use the generated document ID
        documentId = effectiveDocId;
        console.log(`[Doc] Using generated document ID: ${documentId}`);
        localStorage.setItem(this.localStorageKey, documentId);
      } else {
        // Use the provided document ID
        console.log(`[Doc] Using provided document ID: ${documentId}`);
        localStorage.setItem(this.localStorageKey, documentId);
      }
    }

    this.documentId = documentId;

    // Find the document
    try {
      // Try to load the document
      this.handle = this.repo.find<TodoListDoc>(this.documentId as any);
    } catch (error) {
      console.log('Document not found, creating a new one');
      // Create a new document with the specified ID
      this.handle = this.repo.create<TodoListDoc>();
      // Update the document ID
      this.documentId = this.handle.documentId;
      // Save the document ID to localStorage
      localStorage.setItem(this.localStorageKey, this.documentId);
    }

    // Initialize the document with empty todos array if it doesn't exist
    this.handle.update((doc: Doc<TodoListDoc>) => {
      if (!doc.todos) {
        return Automerge.change(doc, (d) => {
          d.todos = [];
        });
      }
      return doc;
    });

    // Set up change handler
    this.handle.on('change', () => {
      if (this.onChangesCallback) {
        const doc = this.handle.docSync();
        if (doc) {
          this.onChangesCallback(doc);
        }
      }
    });

    // Connect to the network
    if (this.networkAdapter) {
      console.log(`[Network] Connecting with peer ID: ${peerId}`);
      this.networkAdapter.connect(peerId as any);
    }
  }

  /**
   * Clean up resources when this instance is no longer needed
   */
  public dispose(): void {
    if (this.networkAdapter) {
      this.networkAdapter.disconnect();
    }
  }

  /**
   * Get the current state of the document
   */
  getDocument(): TodoListDoc {
    const doc = this.handle.docSync();
    if (!doc) {
      return { todos: [] };
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
  onChange(callback: (doc: TodoListDoc) => void): void {
    this.onChangesCallback = callback;

    // Immediately call the callback with the current document
    const doc = this.handle.docSync();
    if (doc) {
      callback(doc);
    }
  }

  /**
   * Register a callback to be called when peer connections change
   */
  onPeerConnection(callback: (connectedCount: number) => void): void {
    this.onPeerConnectionCallback = callback;

    // Immediately call with current number of peers
    if (this.networkAdapter) {
      callback(this.networkAdapter.getConnectedPeers().length);
    }
  }

  /**
   * Generate a shareable URL for this document
   */
  generateShareableUrl(): string {
    // Create URL with document ID (which is also the room ID)
    const url = new URL(window.location.href);
    url.searchParams.set('doc', this.documentId);

    console.log(`[Share] Generated shareable URL with document ID: ${this.documentId}`);
    return url.toString();
  }

  /**
   * Get the number of connected peers
   */
  getConnectedPeerCount(): number {
    if (!this.networkAdapter) {
      return 0;
    }
    return this.networkAdapter.getConnectedPeers().length;
  }

  /**
   * Add a new todo item
   */
  addTodo(text: string): void {
    this.handle.update((doc: Doc<TodoListDoc>) => {
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
    this.handle.update((doc: Doc<TodoListDoc>) => {
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
    this.handle.update((doc: Doc<TodoListDoc>) => {
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
    this.handle.update((doc: Doc<TodoListDoc>) => {
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
    this.handle.update((doc: Doc<TodoListDoc>) => {
      return Automerge.change(doc, (d) => {
        // Filter out completed todos and create a new array
        const activeTodos = d.todos.filter((todo) => !todo.completed);

        // Clear the array
        while (d.todos.length > 0) {
          d.todos.pop();
        }

        // Add all active todos back
        activeTodos.forEach((todo) => {
          d.todos.push(todo);
        });
      });
    });
  }

  /**
   * Check if local storage is being used
   */
  public isUsingLocalStorage(): boolean {
    // Check if the storage adapter is configured in the repo
    return false; // Currently hardcoded to false since storage is commented out
  }
}
