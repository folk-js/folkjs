import * as Automerge from '@automerge/automerge';
import { Doc, DocHandle, Repo } from '@automerge/automerge-repo';
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb';
import { AutomergeRTCAdapter, MQTTBrokerOptions } from '@labs/AutomergeRTCAdapter';

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
  private networkAdapter: AutomergeRTCAdapter;
  private onPeerConnectionCallback: ((count: number) => void) | null = null;

  /**
   * Create a new FolkAutomerge instance
   * @param storageId - Identifier for the storage (used for indexedDB)
   * @param documentId - Optional document ID, if not provided a new one will be created or loaded from localStorage
   * @param roomId - Optional room ID for sharing, if provided will try to connect to that room
   */
  constructor(storageId: string, documentId?: string, roomId?: string) {
    this.localStorageKey = `folk-automerge-docid-${storageId}`;

    // Parse URL params to check for room ID
    const urlParams = new URLSearchParams(window.location.search);
    const urlRoomId = urlParams.get('rtc-room');

    // Use roomId from URL or from constructor parameter
    const effectiveRoomId = urlRoomId || roomId;

    // Initialize network adapter with MQTT options
    const mqttOptions: MQTTBrokerOptions = {};
    if (effectiveRoomId) {
      mqttOptions.roomId = effectiveRoomId;
    }

    this.networkAdapter = new AutomergeRTCAdapter(mqttOptions);

    // Add listener for peer connections
    this.networkAdapter.addConnectionStatusListener((peerId, connected) => {
      if (this.onPeerConnectionCallback) {
        this.onPeerConnectionCallback(this.networkAdapter.getConnectedPeers().length);
      }
    });

    // Generate a peer ID for this instance
    const peerId = `peer-${Math.floor(Math.random() * 1000000)}`;

    // Initialize the automerge repo with storage and network adapters
    this.repo = new Repo({
      storage: new IndexedDBStorageAdapter(storageId),
      network: [this.networkAdapter],
      peerId: peerId as any,
    });

    // If roomId is provided from URL and documentId is not specified, try to load from URL
    if (urlRoomId && !documentId) {
      // Check if there's a document ID in URL
      const urlDocId = urlParams.get('doc');

      if (urlDocId) {
        console.log(`Loading shared document from URL: ${urlDocId}`);
        documentId = urlDocId;

        // Store this document ID
        localStorage.setItem(this.localStorageKey, urlDocId);
      }
    }

    // Try to load document ID from localStorage if not provided
    const savedDocId = !documentId && localStorage.getItem(this.localStorageKey);

    if (savedDocId) {
      // Use the saved document ID
      console.log(`Loading existing document: ${savedDocId}`);
      this.documentId = savedDocId;
    } else if (documentId) {
      // Use the provided document ID
      console.log(`Using provided document: ${documentId}`);
      this.documentId = documentId;
      localStorage.setItem(this.localStorageKey, documentId);
    } else {
      // Create a new document
      console.log('Creating a new document');
      this.documentId = this.repo.create<TodoListDoc>().documentId;
      // Save the document ID to localStorage
      localStorage.setItem(this.localStorageKey, this.documentId);
    }

    // Find the document
    this.handle = this.repo.find<TodoListDoc>(this.documentId as any);

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
    this.networkAdapter.connect(peerId as any);
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
    if (!this.networkAdapter) {
      throw new Error('Network adapter not initialized');
    }

    // Generate base URL with room ID
    const shareUrl = this.networkAdapter.generateShareableUrl();

    // Add document ID
    const url = new URL(shareUrl);
    url.searchParams.set('doc', this.documentId);

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
}
