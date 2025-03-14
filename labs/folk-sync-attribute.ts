import { CustomAttribute } from '@lib';
import { FolkAutomerge } from './FolkAutomerge';

/**
 * Interface for DOM node attributes
 */
interface DOMNodeAttributes {
  [key: string]: string;
}

/**
 * Interface for a serialized DOM node
 */
interface SerializedDOMNode {
  nodeType: number;
  nodeName: string;
  nodeId: string;
  childNodes: SerializedDOMNode[];
  attributes?: DOMNodeAttributes;
  textContent?: string;
}

/**
 * Interface for the DOM sync document structure
 */
interface DOMSyncDocument {
  domTree: SerializedDOMNode;
}

export class FolkSyncAttribute extends CustomAttribute {
  static attributeName = 'folk-sync';

  // The FolkAutomerge instance for network sync
  #automerge!: FolkAutomerge<DOMSyncDocument>;

  // MutationObserver instance
  #observer: MutationObserver | null = null;

  // DOM node to Automerge path mapping
  #nodeToPath = new WeakMap<Node, string[]>();

  // Automerge path to DOM node mapping (using a string representation of the path)
  #pathToNode = new Map<string, Node>();

  // Generate a unique ID for a node
  #generateNodeId(): string {
    return `node-${Math.random().toString(36).substring(2, 11)}`;
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
   * @param doc The Automerge document
   * @param path The path to the node
   * @returns The node in the document or undefined
   */
  #getDocNodeByPath(doc: DOMSyncDocument, path: string[]): any {
    let node: any = doc;
    for (const segment of path) {
      if (node === undefined || node === null) {
        return undefined;
      }
      node = node[segment];
    }
    return node;
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
  #serializeNode(node: Node, path: string[] = []): SerializedDOMNode {
    const nodeType = node.nodeType;
    const nodeName = node.nodeName.toLowerCase();
    const nodeId = this.#generateNodeId();

    // Create the base node object
    const result: SerializedDOMNode = {
      nodeType,
      nodeName,
      nodeId,
      childNodes: [],
    };

    // Store in our bidirectional mapping
    // Add 'domTree' as the first segment in the path for the mapping
    const fullPath = path.length === 0 ? ['domTree'] : ['domTree', ...path];
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

    return result;
  }

  /**
   * Creates or updates a DOM node based on Automerge data
   * @param data The node data from Automerge
   * @param path Current path in the Automerge document
   * @param parent Optional parent node for new nodes
   * @returns The created or updated DOM node
   */
  #deserializeNode(data: SerializedDOMNode, path: string[] = [], parent?: Node): Node {
    // Add 'domTree' as the first segment in the path if it's not already there
    const fullPath = path.length === 0 ? ['domTree'] : path[0] === 'domTree' ? path : ['domTree', ...path];
    let node = this.#getNodeByPath(fullPath);

    // Create new node if it doesn't exist
    if (!node) {
      if (data.nodeType === Node.ELEMENT_NODE) {
        node = document.createElement(data.nodeName);
      } else if (data.nodeType === Node.TEXT_NODE) {
        node = document.createTextNode(data.textContent || '');
      } else {
        // Throw error for unsupported node types instead of creating a comment
        throw new Error(`Unsupported node type: ${data.nodeType}`);
      }

      if (parent) {
        parent.appendChild(node);
      }

      // Update our mappings
      this.#setNodePath(node, fullPath);
    }

    // Update element properties
    if (data.nodeType === Node.ELEMENT_NODE && node instanceof Element) {
      // Update attributes
      if (data.attributes) {
        // Remove attributes not in the data
        for (const attr of node.attributes) {
          if (!(attr.name in data.attributes)) {
            node.removeAttribute(attr.name);
          }
        }

        // Set or update attributes from the data
        for (const [name, value] of Object.entries(data.attributes)) {
          if (node.getAttribute(name) !== value) {
            node.setAttribute(name, value);
          }
        }
      }

      // Update children
      if (data.childNodes) {
        // Stop observing while we update children
        this.#stopObserving();

        try {
          // Process children
          const existingChildren = Array.from(node.childNodes);

          // Create/update children from the data
          data.childNodes.forEach((childData, index) => {
            const childPath = this.#createChildPath(path, index);
            this.#deserializeNode(childData, childPath, node);
          });

          // Remove any extra children
          for (let i = data.childNodes.length; i < existingChildren.length; i++) {
            node.removeChild(existingChildren[i]);
            this.#deleteNodePath(existingChildren[i]);
          }
        } finally {
          // Resume observing
          this.#startObserving();
        }
      }
    }
    // Update text node
    else if (data.nodeType === Node.TEXT_NODE && node instanceof Text) {
      if (node.textContent !== data.textContent) {
        node.textContent = data.textContent || '';
      }
    }

    return node;
  }

  /**
   * Completely replaces the DOM subtree with the one derived from the Automerge document
   * @param data The node data from Automerge
   */
  #replaceDOMSubtree(data: SerializedDOMNode): void {
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
   * Start observing DOM mutations
   */
  #startObserving(): void {
    if (!this.#observer) {
      this.#observer = new MutationObserver((mutations) => {
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
   * Handle DOM mutations and update Automerge document
   */
  #handleMutations(mutations: MutationRecord[]): void {
    if (!this.#automerge) {
      throw new Error('Cannot handle mutations: FolkAutomerge instance not initialized');
    }

    console.log('Processing mutations');

    this.#automerge.change((doc: DOMSyncDocument) => {
      // Ensure domTree exists
      if (!doc.domTree) {
        // Initialize the domTree if it doesn't exist
        console.log('Creating domTree in document');
        doc.domTree = this.#serializeNode(this.ownerElement);
        return;
      }

      for (const mutation of mutations) {
        // Get the path to the affected node in the Automerge document
        const targetPath = this.#getNodePath(mutation.target);
        if (mutation.target === this.ownerElement) {
          console.warn('Mutation target is the owner element, skipping');
          continue;
        }
        if (!targetPath) {
          throw new Error(`Path not found for mutation target: ${mutation.target.nodeName}`);
        }

        // Handle different mutation types
        switch (mutation.type) {
          case 'attributes': {
            // Find the node in the document
            const node = this.#getDocNodeByPath(doc, targetPath);
            if (!node) {
              throw new Error(`Node not found in document at path: ${targetPath.join('.')}`);
            }

            // Update the attribute
            if (mutation.attributeName) {
              const target = mutation.target as Element;
              const attributeExists = target.hasAttribute(mutation.attributeName);

              if (!attributeExists) {
                // Attribute was removed
                if (node.attributes) {
                  delete node.attributes[mutation.attributeName];
                }
              } else {
                // Attribute was added or changed
                if (!node.attributes) node.attributes = {};
                node.attributes[mutation.attributeName] = target.getAttribute(mutation.attributeName) || '';
              }
            }
            break;
          }

          case 'characterData': {
            // Find the node in the document
            const node = this.#getDocNodeByPath(doc, targetPath);
            if (!node) {
              throw new Error(`Node not found in document at path: ${targetPath.join('.')}`);
            }

            // Update the text content
            node.textContent = mutation.target.textContent || '';
            break;
          }

          case 'childList': {
            // Handle added nodes
            for (const addedNode of mutation.addedNodes) {
              // Find the parent node in the document
              const parentNode = this.#getDocNodeByPath(doc, targetPath);
              if (!parentNode) {
                throw new Error(`Parent node not found for added node: ${addedNode.nodeName}`);
              }

              // Find the index where the node was inserted
              const childNodes = Array.from(mutation.target.childNodes);
              const index = childNodes.findIndex((child) => child === addedNode);
              if (index === -1) {
                throw new Error(`Index not found for added node: ${addedNode.nodeName}`);
              }

              // Create the new node path
              const newNodePath = this.#createChildPath(targetPath, index);

              // Serialize the added node
              const serializedNode = this.#serializeNode(addedNode, newNodePath.slice(1)); // Remove 'domTree'

              // Insert the node at the correct position
              parentNode.childNodes.splice(index, 0, serializedNode);

              // Update paths for all subsequent siblings
              this.#updateChildPaths(mutation.target, targetPath, index + 1);
            }

            // Handle removed nodes
            for (const removedNode of mutation.removedNodes) {
              // Find the parent node in the document
              const parentNode = this.#getDocNodeByPath(doc, targetPath);
              if (!parentNode) {
                throw new Error(`Parent node not found for removed node: ${removedNode.nodeName}`);
              }

              // Find the index where the node was removed
              const removedPath = this.#getNodePath(removedNode);
              if (!removedPath) {
                throw new Error(`Path not found for removed node: ${removedNode.nodeName}`);
              }

              const removedIndex = parseInt(removedPath[removedPath.length - 1]);

              // Remove the node
              parentNode.childNodes.splice(removedIndex, 1);

              // Clean up our mappings
              this.#deleteNodePath(removedNode);

              // Update paths for all subsequent siblings
              this.#updateChildPaths(mutation.target, targetPath, removedIndex);
            }
            break;
          }
        }
      }
    });
  }

  /**
   * Handle changes from the Automerge document and update DOM
   */
  #handleDocumentChange(doc: DOMSyncDocument): void {
    if (!doc) {
      throw new Error('Cannot handle document change: Document is null or undefined');
    }

    // Stop observing while we update the DOM
    this.#stopObserving();

    try {
      // Update the DOM tree to match the document
      if (doc.domTree) {
        this.#deserializeNode(doc.domTree, []);
      } else {
        // If there's no domTree in the document, initialize it from the current DOM
        console.log('No domTree in document, initializing from current DOM');
        this.#automerge.change((newDoc) => {
          newDoc.domTree = this.#serializeNode(this.ownerElement);
        });
      }
    } catch (error) {
      console.error('Error updating DOM from document:', error);
      throw error; // Re-throw to ensure the error is not swallowed
    } finally {
      // Resume observing
      this.#startObserving();
    }
  }

  /**
   * Initialize when the attribute is connected to the DOM
   */
  connectedCallback(): void {
    console.log(`FolkSync connected to <${this.ownerElement.tagName.toLowerCase()}>`);

    if (!this.ownerElement) {
      throw new Error('FolkSync attribute connected without an owner element');
    }

    // Initialize FolkAutomerge for network sync with an empty constructor
    this.#automerge = new FolkAutomerge<DOMSyncDocument>();

    // When the document is ready, either initialize from the document or from the DOM
    this.#automerge.whenReady().then((doc) => {
      // Stop observing while we initialize
      this.#stopObserving();

      try {
        if (!doc.domTree) {
          // No domTree in the document: serialize the DOM into the document
          console.log('Initializing new document from DOM');
          this.#automerge.change((newDoc) => {
            // Create a structured document with a dedicated property for the DOM tree
            newDoc.domTree = this.#serializeNode(this.ownerElement);
            console.log('Initialized document with DOM tree:', newDoc);
          });
        } else {
          // Existing document: update the DOM to match
          console.log('Initializing DOM from existing document');
          // Completely replace the DOM subtree with the one from the Automerge document
          this.#replaceDOMSubtree(doc.domTree);
        }
      } finally {
        // Resume observing
        this.#startObserving();
      }

      // Set up the change handler for future updates
      this.#automerge.onChange((updatedDoc) => {
        this.#handleDocumentChange(updatedDoc);
      });
    });

    console.log('FolkSync initialized with document ID:', this.#automerge.getDocumentId());
  }

  /**
   * Stop observing DOM mutations
   */
  #stopObserving(): void {
    if (this.#observer) {
      this.#observer.disconnect();
    }
  }
}

FolkSyncAttribute.define();
