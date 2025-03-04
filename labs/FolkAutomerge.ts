import * as Automerge from '@automerge/automerge';
import { Doc, DocHandle, Repo } from '@automerge/automerge-repo';
import { BroadcastChannelNetworkAdapter } from '@automerge/automerge-repo-network-broadcastchannel';
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb';

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

  /**
   * Create a new FolkAutomerge instance
   * @param storageId - Identifier for the storage (used for indexedDB)
   * @param documentId - Optional document ID, if not provided a new one will be created or loaded from localStorage
   */
  constructor(storageId: string, documentId?: string) {
    this.localStorageKey = `folk-automerge-docid-${storageId}`;

    // Initialize the automerge repo with storage and network adapters
    this.repo = new Repo({
      storage: new IndexedDBStorageAdapter(storageId),
      network: [new BroadcastChannelNetworkAdapter()],
      peerId: `peer-${Math.floor(Math.random() * 1000000)}` as any,
    });

    // Try to load document ID from localStorage if not provided
    const savedDocId = !documentId && localStorage.getItem(this.localStorageKey);

    if (savedDocId) {
      // Use the saved document ID
      console.log(`Loading existing document: ${savedDocId}`);
      this.documentId = savedDocId;
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
