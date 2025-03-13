import { AnyDocumentId, DocHandle, isValidAutomergeUrl, Repo } from '@automerge/automerge-repo';
import { BrowserWebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket';

export interface Todo {
  id: string;
  text: string;
  completed: boolean;
  createdAt: number;
}

export interface TodoListDoc {
  todos: Todo[];
}

export class FolkAutomerge<T extends TodoListDoc> {
  private repo: Repo;
  private handle!: DocHandle<T>;
  private networkAdapter: BrowserWebSocketClientAdapter;

  constructor() {
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
            this.#createNewDocAndUpdateHash();
          }
        } catch (error) {
          console.error('Error finding document:', error);
          this.#createNewDocAndUpdateHash();
        }
      });
    } else {
      this.#createNewDocAndUpdateHash();
    }

    // Initialize todos array if it doesn't exist
    this.whenReady().then(() => {
      this.handle.change((doc: any) => {
        if (!doc.todos) {
          doc.todos = [];
        }
      });
    });
  }

  /**
   * Create a new document and update the URL hash
   */
  #createNewDocAndUpdateHash(): void {
    // Create a new document with initial state
    const initialState = { todos: [] } as unknown as T;
    this.handle = this.repo.create<T>(initialState);

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
   */
  whenReady(): Promise<void> {
    return this.handle.whenReady();
  }

  /**
   * Get the document asynchronously
   */
  async getDocumentAsync(): Promise<T> {
    const doc = await this.handle.doc();
    if (!doc) {
      return { todos: [] } as unknown as T;
    }
    return doc as T;
  }

  /**
   * Get the document synchronously (use only when you know the document is ready)
   */
  getDocument(): T {
    if (!this.handle.isReady()) {
      console.log('[Doc] Handle not ready, returning empty document');
      return { todos: [] } as unknown as T;
    }
    const doc = this.handle.docSync();
    if (!doc) {
      return { todos: [] } as unknown as T;
    }
    return doc as T;
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
  onDocumentChange(callback: (doc: T) => void): void {
    // Use the 'change' event to get document updates
    this.handle.on('change', ({ doc }) => {
      if (doc) {
        callback(doc as T);
      }
    });
  }

  /**
   * Generate a shareable URL for this document
   */
  generateShareableUrl(baseUrl: string = window.location.href): string {
    const url = new URL(baseUrl);
    url.searchParams.set('space', this.handle.url);
    return url.toString();
  }

  /**
   * Add a new todo item
   */
  addTodo(text: string): void {
    this.handle.change((doc: any) => {
      doc.todos.push({
        id: crypto.randomUUID(),
        text,
        completed: false,
        createdAt: Date.now(),
      });
    });
  }

  /**
   * Toggle the completed status of a todo
   */
  toggleTodo(id: string): void {
    this.handle.change((doc: any) => {
      const todo = doc.todos.find((t: Todo) => t.id === id);
      if (todo) {
        todo.completed = !todo.completed;
      }
    });
  }

  /**
   * Edit a todo's text
   */
  editTodo(id: string, newText: string): void {
    this.handle.change((doc: any) => {
      const todo = doc.todos.find((t: Todo) => t.id === id);
      if (todo) {
        todo.text = newText;
      }
    });
  }

  /**
   * Delete a todo
   */
  deleteTodo(id: string): void {
    this.handle.change((doc: any) => {
      const index = doc.todos.findIndex((t: Todo) => t.id === id);
      if (index !== -1) {
        doc.todos.splice(index, 1);
      }
    });
  }

  /**
   * Clear all completed todos
   */
  clearCompleted(): void {
    this.handle.change((doc: any) => {
      // We need to remove items one by one, starting from the end
      // to avoid index shifting problems
      for (let i = doc.todos.length - 1; i >= 0; i--) {
        if (doc.todos[i].completed) {
          doc.todos.splice(i, 1);
        }
      }
    });
  }

  /**
   * Clean up resources when the instance is no longer needed
   */
  dispose(): void {
    // Remove any event listeners
    if (this.handle) {
      this.handle.removeAllListeners('change');
    }
  }
}
