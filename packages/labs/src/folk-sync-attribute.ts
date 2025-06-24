import { type AnyDocumentId, DocHandle, isValidAutomergeUrl, Repo } from '@automerge/automerge-repo';
import { BrowserWebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket';
import { CustomAttribute } from '@folkjs/canvas';

/**
 * Interface for DOM node attributes
 */
interface DOMNodeAttributes {
  [key: string]: string;
}

/**
 * Interface for a serialized DOM node
 */
interface DOMNode {
  nodeType: number;
  nodeName: string;
  nodeId: string;
  childNodes: DOMNode[];
  attributes?: DOMNodeAttributes;
  textContent?: string;
}

/**
 * Operation represents a single atomic change to either the DOM or the Automerge document
 */
interface SyncOperation {
  // The type of operation
  type: 'setAttribute' | 'removeAttribute' | 'setText' | 'addNode' | 'removeNode' | 'moveNode';

  // The path to the target node in the document
  path: string[];

  // Operation-specific data
  data?: {
    attributeName?: string;
    attributeValue?: string;
    textContent?: string;
    node?: DOMNode;
    fromIndex?: number;
    toIndex?: number;
  };
}

// DOMSyncDocument interface is no longer needed as we use DOMNode directly

export class FolkSyncAttribute extends CustomAttribute {
  static override attributeName = 'folk-sync';

  // Automerge repository and document handle
  #repo!: Repo;
  #handle!: DocHandle<DOMNode>;
  #networkAdapter!: BrowserWebSocketClientAdapter;
  #isLocalChange: boolean = false;

  // MutationObserver instance
  #observer: MutationObserver | null = null;

  // DOM node to Automerge path mapping
  #nodeToPath = new WeakMap<Node, string[]>();

  // Automerge path to DOM node mapping (using a string representation of the path)
  #pathToNode = new Map<string, Node>();

  // Flag to prevent recursive updates
  #isApplyingRemoteChanges = false;

  // Generate a unique ID for a node
  #generateNodeId(): string {
    return `node-${Math.random().toString(36).substring(2, 11)}`;
  }

  // Generate a random peer ID for this client
  #generatePeerId(): string {
    return `peer-${Math.floor(Math.random() * 1_000_000)}`;
  }

  // Create new document and update URL hash
  #createNewDocAndUpdateHash(initialState?: DOMNode): void {
    this.#handle = this.#repo.create<DOMNode>(initialState as any);

    this.#handle.whenReady().then(() => {
      window.location.hash = this.#handle.url;
    });
  }

  // Apply changes to the document in a single transaction
  #changeDocument(changeFunc: (doc: DOMNode) => void): void {
    this.#isLocalChange = true;
    try {
      this.#handle.change((doc: any) => {
        changeFunc(doc as DOMNode);
      });
    } finally {
      // Reset the flag after the change is applied
      this.#isLocalChange = false;
    }
  }

  // Get the document URL that can be shared
  #getDocumentId(): string {
    return this.#handle.url;
  }

  /**
   * @param node The DOM node
   * @returns The path array or undefined if not found
   */
  #getNodePath(node: Node): string[] | undefined {
    return this.#nodeToPath.get(node);
  }

  /**
   * @param path The path array
   * @returns The DOM node or undefined if not found
   */
  #getNodeByPath(path: string[]): Node | undefined {
    return this.#pathToNode.get(path.join('.'));
  }

  /**
   * @param node The DOM node
   * @param path The path array
   */
  #setNodePath(node: Node, path: string[]): void {
    this.#nodeToPath.set(node, path);
    this.#pathToNode.set(path.join('.'), node);
  }

  /**
   * @param node The DOM node
   */
  #deleteNodePath(node: Node): void {
    const path = this.#nodeToPath.get(node);
    if (path) {
      this.#pathToNode.delete(path.join('.'));
      this.#nodeToPath.delete(node);
    }
  }

  /**
   * Updates paths for all children of a node after structural changes
   * @param parentNode The parent DOM node
   * @param parentPath The path to the parent node
   * @param startIndex The index to start updating from
   */
  #updateChildPaths(parentNode: Node, parentPath: string[], startIndex: number = 0): void {
    const childNodes = Array.from(parentNode.childNodes);

    for (let i = startIndex; i < childNodes.length; i++) {
      const child = childNodes[i];
      const childPath = this.#createChildPath(parentPath, i);

      // Update this child's path
      this.#setNodePath(child, childPath);

      // Recursively update grandchildren
      if (child.hasChildNodes()) {
        this.#updateChildPaths(child, childPath);
      }
    }
  }

  /**
   * Creates a path to a child node at the specified index
   * @param parentPath The parent node's path
   * @param index The child's index
   * @returns The child node's path
   */
  #createChildPath(parentPath: string[], index: number): string[] {
    return [...parentPath, 'childNodes', index.toString()];
  }

  /**
   * Converts a DOM node to our Automerge structure
   * @param node The DOM node to serialize
   * @param path Current path in the Automerge document
   * @returns The serialized node structure
   */
  #serializeNode(node: Node, path: string[] = []): DOMNode {
    const nodeType = node.nodeType;
    const nodeName = node.nodeName.toLowerCase();
    const nodeId = this.#generateNodeId();

    // Create the base node object
    const result: DOMNode = {
      nodeType,
      nodeName,
      nodeId,
      childNodes: [],
    };

    // Store in our bidirectional mapping
    const fullPath = path;
    this.#setNodePath(node, fullPath);

    // Handle element-specific properties
    if (nodeType === Node.ELEMENT_NODE && node instanceof Element) {
      // Serialize attributes
      result.attributes = {};
      for (const attr of node.attributes) {
        result.attributes[attr.name] = attr.value;
      }

      // Serialize children
      Array.from(node.childNodes).forEach((child, index) => {
        const childPath = this.#createChildPath(path, index);
        result.childNodes.push(this.#serializeNode(child, childPath));
      });
    }
    // Handle text nodes
    else if (nodeType === Node.TEXT_NODE) {
      result.textContent = node.textContent || '';
    }
    // Handle comment nodes
    else if (nodeType === Node.COMMENT_NODE) {
      result.textContent = node.textContent || '';
    }

    return result;
  }

  /**
   * Converts a mutation record to sync operations
   * @param mutation The DOM mutation record
   * @returns Array of corresponding sync operations
   */
  #mutationToOperations(mutation: MutationRecord): SyncOperation[] {
    const operations: SyncOperation[] = [];
    const targetPath = this.#getNodePath(mutation.target);

    // Handle mutations on the owner element
    if (mutation.target === this.ownerElement) {
      if (mutation.type === 'attributes' && mutation.attributeName) {
        const attributeExists = (mutation.target as Element).hasAttribute(mutation.attributeName);

        if (!attributeExists) {
          operations.push({
            type: 'removeAttribute',
            path: [],
            data: {
              attributeName: mutation.attributeName,
            },
          });
        } else {
          operations.push({
            type: 'setAttribute',
            path: [],
            data: {
              attributeName: mutation.attributeName,
              attributeValue: (mutation.target as Element).getAttribute(mutation.attributeName) || '',
            },
          });
        }
      }
      return operations;
    }

    if (!targetPath) {
      console.error(`Path not found for mutation target: ${mutation.target.nodeName}`);
      return operations; // Return empty array instead of null
    }

    switch (mutation.type) {
      case 'attributes': {
        if (mutation.attributeName) {
          const target = mutation.target as Element;
          const attributeExists = target.hasAttribute(mutation.attributeName);

          if (!attributeExists) {
            operations.push({
              type: 'removeAttribute',
              path: targetPath,
              data: {
                attributeName: mutation.attributeName,
              },
            });
          } else {
            operations.push({
              type: 'setAttribute',
              path: targetPath,
              data: {
                attributeName: mutation.attributeName,
                attributeValue: target.getAttribute(mutation.attributeName) || '',
              },
            });
          }
        }
        break;
      }

      case 'characterData': {
        operations.push({
          type: 'setText',
          path: targetPath,
          data: {
            textContent: mutation.target.textContent || '',
          },
        });
        break;
      }

      case 'childList': {
        // Handle removed nodes first (important for index consistency)
        for (const removedNode of mutation.removedNodes) {
          const removedPath = this.#getNodePath(removedNode);

          if (removedPath) {
            const removedIndex = parseInt(removedPath[removedPath.length - 1]);

            operations.push({
              type: 'removeNode',
              path: targetPath,
              data: {
                fromIndex: removedIndex,
              },
            });

            // Clean up our mappings
            this.#deleteNodePath(removedNode);
          }
        }

        // Then handle added nodes
        for (const addedNode of mutation.addedNodes) {
          // Find the index where the node was inserted
          const childNodes = Array.from(mutation.target.childNodes);
          const index = childNodes.findIndex((child) => child === addedNode);

          if (index !== -1) {
            // Create the new node path
            const newNodePath = this.#createChildPath(targetPath, index);

            // Serialize the added node
            const serializedNode = this.#serializeNode(addedNode, newNodePath);

            operations.push({
              type: 'addNode',
              path: targetPath,
              data: {
                node: serializedNode,
                toIndex: index,
              },
            });
          }
        }
        break;
      }
    }

    return operations;
  }

  /**
   * Apply a sync operation to the Automerge document
   * @param doc The Automerge document
   * @param operation The operation to apply
   */
  #applyOperationToDoc(doc: DOMNode, operation: SyncOperation): void {
    // Find the target node in the document
    let target = doc;

    // Navigate to the target node using the path
    for (let i = 0; i < operation.path.length; i += 2) {
      const prop = operation.path[i];
      const index = parseInt(operation.path[i + 1]);

      if (prop === 'childNodes') {
        target = target.childNodes[index];
      } else {
        target = target[prop as keyof DOMNode] as any;
      }

      if (!target) {
        console.error(`Target node not found at path: ${operation.path.join('.')}`);
        return;
      }
    }

    // Apply the operation based on its type
    switch (operation.type) {
      case 'setAttribute': {
        if (!target.attributes) target.attributes = {};
        target.attributes[operation.data!.attributeName!] = operation.data!.attributeValue!;
        break;
      }

      case 'removeAttribute': {
        if (target.attributes) {
          delete target.attributes[operation.data!.attributeName!];
        }
        break;
      }

      case 'setText': {
        target.textContent = operation.data!.textContent!;
        break;
      }

      case 'addNode': {
        const index = operation.data!.toIndex!;
        target.childNodes.splice(index, 0, operation.data!.node!);
        break;
      }

      case 'removeNode': {
        const index = operation.data!.fromIndex!;
        target.childNodes.splice(index, 1);
        break;
      }

      case 'moveNode': {
        const fromIndex = operation.data!.fromIndex!;
        const toIndex = operation.data!.toIndex!;
        const node = target.childNodes[fromIndex];
        target.childNodes.splice(fromIndex, 1);
        target.childNodes.splice(toIndex, 0, node);
        break;
      }
    }
  }

  /**
   * Apply a sync operation to the DOM
   * @param operation The operation to apply
   */
  #applyOperationToDOM(operation: SyncOperation): void {
    // Find the target node in the DOM
    let targetNode: Node;

    if (operation.path.length === 0) {
      targetNode = this.ownerElement;
    } else {
      const foundNode = this.#getNodeByPath(operation.path);
      if (!foundNode) {
        console.error(`Target DOM node not found at path: ${operation.path.join('.')}`);
        return;
      }
      targetNode = foundNode;
    }

    // Apply the operation based on its type
    switch (operation.type) {
      case 'setAttribute': {
        if (targetNode instanceof Element) {
          targetNode.setAttribute(operation.data!.attributeName!, operation.data!.attributeValue!);
        }
        break;
      }

      case 'removeAttribute': {
        if (targetNode instanceof Element) {
          targetNode.removeAttribute(operation.data!.attributeName!);
        }
        break;
      }

      case 'setText': {
        targetNode.textContent = operation.data!.textContent!;
        break;
      }

      case 'addNode': {
        const parentNode = targetNode;
        const index = operation.data!.toIndex!;
        const newNode = this.#deserializeNode(operation.data!.node!);

        // Insert at the correct position
        const childNodes = Array.from(parentNode.childNodes);
        if (index >= childNodes.length) {
          parentNode.appendChild(newNode);
        } else {
          parentNode.insertBefore(newNode, childNodes[index]);
        }

        // Update paths for all subsequent siblings
        this.#updateChildPaths(parentNode, operation.path, index + 1);
        break;
      }

      case 'removeNode': {
        const parentNode = targetNode;
        const index = operation.data!.fromIndex!;
        const childNodes = Array.from(parentNode.childNodes);

        if (index < childNodes.length) {
          const nodeToRemove = childNodes[index];
          parentNode.removeChild(nodeToRemove);

          // Update paths for all subsequent siblings
          this.#updateChildPaths(parentNode, operation.path, index);
        }
        break;
      }

      case 'moveNode': {
        const parentNode = targetNode;
        const fromIndex = operation.data!.fromIndex!;
        const toIndex = operation.data!.toIndex!;
        const childNodes = Array.from(parentNode.childNodes);

        if (fromIndex < childNodes.length) {
          const nodeToMove = childNodes[fromIndex];

          // Remove from old position
          parentNode.removeChild(nodeToMove);

          // Insert at new position
          const updatedChildNodes = Array.from(parentNode.childNodes);
          if (toIndex >= updatedChildNodes.length) {
            parentNode.appendChild(nodeToMove);
          } else {
            parentNode.insertBefore(nodeToMove, updatedChildNodes[toIndex]);
          }

          // Update paths for all affected siblings
          this.#updateChildPaths(parentNode, operation.path);
        }
        break;
      }
    }
  }

  /**
   * Creates or updates a DOM node based on Automerge data
   * @param data The node data from Automerge
   * @param path Current path in the Automerge document
   * @param parent Optional parent node for new nodes
   * @returns The created or updated DOM node
   */
  #deserializeNode(data: DOMNode, path: string[] = [], parent?: Node): Node {
    let node: Node;

    // Create the appropriate node type
    if (data.nodeType === Node.ELEMENT_NODE) {
      node = document.createElement(data.nodeName);
    } else if (data.nodeType === Node.TEXT_NODE) {
      node = document.createTextNode(data.textContent || '');
    } else if (data.nodeType === Node.COMMENT_NODE) {
      node = document.createComment(data.textContent || '');
    } else {
      throw new Error(`Unsupported node type: ${data.nodeType}`);
    }

    // Update our mappings
    if (path.length > 0) {
      this.#setNodePath(node, path);
    }

    // Set attributes for element nodes
    if (data.nodeType === Node.ELEMENT_NODE && node instanceof Element && data.attributes) {
      for (const [name, value] of Object.entries(data.attributes)) {
        node.setAttribute(name, value);
      }
    }

    // Add children for element nodes
    if (data.nodeType === Node.ELEMENT_NODE && data.childNodes) {
      data.childNodes.forEach((childData, index) => {
        const childPath = this.#createChildPath(path, index);
        const childNode = this.#deserializeNode(childData, childPath);
        node.appendChild(childNode);
      });
    }

    // Add to parent if provided
    if (parent) {
      parent.appendChild(node);
    }

    return node;
  }

  /**
   * Start observing DOM mutations
   */
  #startObserving(): void {
    if (!this.#observer) {
      this.#observer = new MutationObserver((mutations) => {
        if (this.#isApplyingRemoteChanges) return;
        this.#handleMutations(mutations);
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
   * Handle DOM mutations and update Automerge document
   */
  #handleMutations(mutations: MutationRecord[]): void {
    if (!this.#handle) {
      throw new Error('Cannot handle mutations: Document handle not initialized');
    }

    // Process each mutation as an operation
    for (const mutation of mutations) {
      const operations = this.#mutationToOperations(mutation);
      if (operations.length === 0) {
        console.warn('No operations generated for mutation', mutation);
        continue;
      }

      this.#changeDocument((doc: DOMNode) => {
        // If document is empty, initialize it
        if (!doc.nodeType) {
          console.log('Creating document from DOM');
          // Copy all properties from the serialized node to the document
          const serialized = this.#serializeNode(this.ownerElement);
          Object.assign(doc, serialized);
          return;
        }

        // Apply all operations from this mutation
        for (const operation of operations) {
          this.#applyOperationToDoc(doc, operation);
        }
      });
    }
  }

  /**
   * Compare two Automerge documents and generate operations to transform one into the other
   * @param oldDoc The old document state
   * @param newDoc The new document state
   * @returns Array of operations to transform oldDoc into newDoc
   */
  #diffDocuments(oldDoc: DOMNode, newDoc: DOMNode): SyncOperation[] {
    const operations: SyncOperation[] = [];

    // Helper function to recursively diff nodes
    const diffNodes = (oldNode: DOMNode, newNode: DOMNode, path: string[] = []): void => {
      // Check attributes
      if (oldNode.attributes && newNode.attributes) {
        // Find attributes that were added or changed
        for (const [name, value] of Object.entries(newNode.attributes)) {
          if (!oldNode.attributes[name] || oldNode.attributes[name] !== value) {
            operations.push({
              type: 'setAttribute',
              path,
              data: {
                attributeName: name,
                attributeValue: value,
              },
            });
          }
        }

        // Find attributes that were removed
        for (const name of Object.keys(oldNode.attributes)) {
          if (!(name in newNode.attributes)) {
            operations.push({
              type: 'removeAttribute',
              path,
              data: {
                attributeName: name,
              },
            });
          }
        }
      }

      // Check text content for text and comment nodes
      if (oldNode.nodeType === Node.TEXT_NODE || oldNode.nodeType === Node.COMMENT_NODE) {
        if (oldNode.textContent !== newNode.textContent) {
          operations.push({
            type: 'setText',
            path,
            data: {
              textContent: newNode.textContent || '',
            },
          });
        }
        return; // No need to check children for text/comment nodes
      }

      // Check children
      const oldChildren = oldNode.childNodes || [];
      const newChildren = newNode.childNodes || [];

      // Simple diff algorithm - can be improved with a proper diff algorithm
      let i = 0;
      while (i < oldChildren.length && i < newChildren.length) {
        // If node types or names differ, replace the node
        if (
          oldChildren[i].nodeType !== newChildren[i].nodeType ||
          oldChildren[i].nodeName !== newChildren[i].nodeName
        ) {
          operations.push({
            type: 'removeNode',
            path,
            data: {
              fromIndex: i,
            },
          });

          operations.push({
            type: 'addNode',
            path,
            data: {
              node: newChildren[i],
              toIndex: i,
            },
          });
        } else {
          // Recursively diff the children
          diffNodes(oldChildren[i], newChildren[i], [...path, 'childNodes', i.toString()]);
        }
        i++;
      }

      // Handle remaining old children (to be removed)
      while (i < oldChildren.length) {
        operations.push({
          type: 'removeNode',
          path,
          data: {
            fromIndex: i,
          },
        });
        i++;
      }

      // Handle remaining new children (to be added)
      while (i < newChildren.length) {
        operations.push({
          type: 'addNode',
          path,
          data: {
            node: newChildren[i],
            toIndex: i,
          },
        });
        i++;
      }
    };

    // Start the diff from the root
    diffNodes(oldDoc, newDoc);

    return operations;
  }

  /**
   * Handle changes from the Automerge document and update DOM
   */
  #handleDocumentChange(oldDoc: DOMNode | null, newDoc: DOMNode): void {
    if (!newDoc) {
      throw new Error('Cannot handle document change: Document is null or undefined');
    }

    // Stop observing while we update the DOM
    this.#stopObserving();
    this.#isApplyingRemoteChanges = true;

    try {
      if (!oldDoc || !oldDoc.nodeType) {
        // Complete replacement if we don't have a valid old document
        this.#replaceDOMSubtree(newDoc);
      } else {
        // Generate and apply operations to transform the DOM
        const operations = this.#diffDocuments(oldDoc, newDoc);

        for (const operation of operations) {
          this.#applyOperationToDOM(operation);
        }
      }
    } catch (error) {
      console.error('Error updating DOM from document:', error);
      throw error;
    } finally {
      // Resume observing
      this.#isApplyingRemoteChanges = false;
      this.#startObserving();
    }
  }

  /**
   * Completely replaces the DOM subtree with the one derived from the Automerge document
   * @param data The node data from Automerge
   */
  #replaceDOMSubtree(data: DOMNode): void {
    console.log('Replacing DOM subtree with Automerge data');

    // Clear our mappings
    this.#nodeToPath = new WeakMap<Node, string[]>();
    this.#pathToNode = new Map<string, Node>();

    // Clear the owner element's content
    const ownerElement = this.ownerElement;

    // Keep track of the original attributes
    const originalAttributes: { [key: string]: string } = {};
    for (const attr of ownerElement.attributes) {
      originalAttributes[attr.name] = attr.value;
    }

    // Remove all children
    while (ownerElement.firstChild) {
      ownerElement.removeChild(ownerElement.firstChild);
    }

    // Remove all attributes
    while (ownerElement.attributes.length > 0) {
      ownerElement.removeAttribute(ownerElement.attributes[0].name);
    }

    // Create a new element from the data
    if (data.nodeType === Node.ELEMENT_NODE) {
      // Set attributes from the data
      if (data.attributes) {
        for (const [name, value] of Object.entries(data.attributes)) {
          ownerElement.setAttribute(name, value);
        }
      }

      // Restore the folk-sync attribute if it was removed
      if (!ownerElement.hasAttribute('folk-sync')) {
        ownerElement.setAttribute('folk-sync', originalAttributes['folk-sync'] || '');
      }

      // Create children from the data
      if (data.childNodes) {
        data.childNodes.forEach((childData, index) => {
          const childPath = this.#createChildPath([], index);
          this.#deserializeNode(childData, childPath, ownerElement);
        });
      }
    }

    console.log('DOM subtree replacement complete');
  }

  /**
   * Initialize when the attribute is connected to the DOM
   */
  override connectedCallback(): void {
    console.log(`FolkSync connected to <${this.ownerElement.tagName.toLowerCase()}>`);

    if (!this.ownerElement) {
      throw new Error('FolkSync attribute connected without an owner element');
    }

    // Initialize in a clean state
    this.#nodeToPath = new WeakMap<Node, string[]>();
    this.#pathToNode = new Map<string, Node>();

    // Initialize Automerge repository and document
    const peerId = this.#generatePeerId();

    // Check if there's a valid Automerge URL in the hash
    const hashDocId = window.location.hash.slice(1);
    let docId: string | undefined;

    if (hashDocId && isValidAutomergeUrl(hashDocId)) {
      docId = hashDocId;
    }

    // Set up the WebSocket network adapter
    this.#networkAdapter = new BrowserWebSocketClientAdapter('wss://sync.automerge.org');

    // Initialize the repo with network configuration
    this.#repo = new Repo({
      peerId: peerId as any,
      network: [this.#networkAdapter],
    });

    // Either connect to existing document or create a new one
    if (docId) {
      this.#handle = this.#repo.find<DOMNode>(docId as unknown as AnyDocumentId);

      // Verify document exists or create a new one
      this.#handle.whenReady().then(async () => {
        try {
          const doc = await this.#handle.doc();
          if (!doc) {
            this.#createNewDocAndUpdateHash();
          } else {
            this.#initializeWithDocument(doc);
          }
        } catch (error) {
          console.error('Error finding document:', error);
          this.#createNewDocAndUpdateHash();
        }
      });
    } else {
      this.#createNewDocAndUpdateHash();
    }

    // Set up initialization after document is ready
    this.#handle
      .whenReady()
      .then(async () => {
        const doc = await this.#handle.doc();
        if (doc) {
          this.#initializeWithDocument(doc);
        }
      })
      .catch((error: any) => {
        console.error('FolkSync initialization promise rejected:', error);
        throw error;
      });
  }

  /**
   * Initialize the sync system once we have a document
   */
  async #initializeWithDocument(doc: DOMNode): Promise<void> {
    try {
      if (!doc.nodeType) {
        // No valid document: serialize the DOM into the document
        console.log('Initializing new document from DOM');
        this.#changeDocument((newDoc: DOMNode) => {
          // Serialize the owner element and copy all properties to the document
          const serialized = this.#serializeNode(this.ownerElement);
          Object.assign(newDoc, serialized);
          console.log('Initialized document with DOM tree:', newDoc);
        });
      } else {
        // Existing document: update the DOM to match
        console.log('Initializing DOM from existing document');
        // Completely replace the DOM subtree with the one from the Automerge document
        this.#replaceDOMSubtree(doc);
      }

      // Set up the change handler for future updates only after successful initialization
      let previousDoc = doc;
      this.#handle.on('change', ({ doc: updatedDoc }) => {
        if (updatedDoc && !this.#isLocalChange) {
          this.#handleDocumentChange(previousDoc, updatedDoc as DOMNode);
          previousDoc = updatedDoc as DOMNode;
        }
      });

      // Start observing only after successful initialization
      this.#startObserving();

      console.log('FolkSync successfully initialized with document ID:', this.#getDocumentId());
    } catch (error) {
      console.error('FolkSync initialization failed:', error);
      // Fail fast, don't try to recover
      throw error;
    }
  }

  /**
   * Clean up when the attribute is disconnected from the DOM
   */
  override disconnectedCallback(): void {
    this.#stopObserving();
    console.log(`FolkSync disconnected from <${this.ownerElement.tagName.toLowerCase()}>`);
  }
}

FolkSyncAttribute.define();
