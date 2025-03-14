import { CustomAttribute } from '@lib';
import { FolkAutomerge } from './FolkAutomerge';

export class FolkSyncAttribute extends CustomAttribute {
  static attributeName = 'folk-sync';

  // The FolkAutomerge instance for network sync
  #automerge!: FolkAutomerge<any>;

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
   * Converts a DOM node to our Automerge structure
   * @param node The DOM node to serialize
   * @param path Current path in the Automerge document
   * @returns The serialized node structure
   */
  #serializeNode(node: Node, path: string[] = []): any {
    const nodeType = node.nodeType;
    const nodeName = node.nodeName.toLowerCase();
    const nodeId = this.#generateNodeId();

    // Create the base node object
    const result: any = {
      nodeType,
      nodeName,
      nodeId,
      childNodes: [],
    };

    // Store in our bidirectional mapping
    // Add 'domTree' as the first segment in the path for the mapping
    const fullPath = path.length === 0 ? ['domTree'] : ['domTree', ...path];
    this.#nodeToPath.set(node, fullPath);
    this.#pathToNode.set(fullPath.join('.'), node);

    // Handle element-specific properties
    if (nodeType === Node.ELEMENT_NODE && node instanceof Element) {
      // Serialize attributes
      result.attributes = {};
      for (const attr of node.attributes) {
        result.attributes[attr.name] = attr.value;
      }

      // Serialize children
      Array.from(node.childNodes).forEach((child, index) => {
        const childPath = [...path, 'childNodes', index.toString()];
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
  #deserializeNode(data: any, path: string[] = [], parent?: Node): Node {
    // Add 'domTree' as the first segment in the path if it's not already there
    const fullPath = path.length === 0 ? ['domTree'] : path[0] === 'domTree' ? path : ['domTree', ...path];
    const pathKey = fullPath.join('.');
    let node = this.#pathToNode.get(pathKey);

    // Create new node if it doesn't exist
    if (!node) {
      if (data.nodeType === Node.ELEMENT_NODE) {
        node = document.createElement(data.nodeName);
      } else if (data.nodeType === Node.TEXT_NODE) {
        node = document.createTextNode(data.textContent || '');
      } else {
        // Handle other node types if needed
        node = document.createComment('Unsupported node type');
      }

      if (!node) {
        throw new Error('Node is undefined or null');
      }

      if (parent) {
        parent.appendChild(node);
      }

      // Update our mappings
      this.#nodeToPath.set(node, [...fullPath]);
      this.#pathToNode.set(pathKey, node);
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
            node.setAttribute(name, value as string);
          }
        }
      }

      // Update children
      if (data.childNodes) {
        // Stop observing while we update children
        this.#stopObserving();

        // Process children
        const existingChildren = Array.from(node.childNodes);

        // Create/update children from the data
        data.childNodes.forEach((childData: any, index: number) => {
          const childPath = [...fullPath, 'childNodes', index.toString()];
          this.#deserializeNode(childData, childPath, node);
        });

        // Remove any extra children
        for (let i = data.childNodes.length; i < existingChildren.length; i++) {
          node.removeChild(existingChildren[i]);

          // Clean up our mappings
          const childPath = this.#nodeToPath.get(existingChildren[i]);
          if (childPath) {
            this.#pathToNode.delete(childPath.join('.'));
            this.#nodeToPath.delete(existingChildren[i]);
          }
        }

        // Resume observing
        this.#startObserving();
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
  #replaceDOMSubtree(data: any): void {
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
          ownerElement.setAttribute(name, value as string);
        }
      }

      // Restore the folk-sync attribute if it was removed
      if (!ownerElement.hasAttribute('folk-sync')) {
        ownerElement.setAttribute('folk-sync', originalAttributes['folk-sync'] || '');
      }

      // Create children from the data
      if (data.childNodes) {
        data.childNodes.forEach((childData: any, index: number) => {
          const childPath = ['childNodes', index.toString()];
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

    console.log('Started observing DOM mutations');
  }

  /**
   * Handle DOM mutations and update Automerge document
   */
  #handleMutations(mutations: MutationRecord[]): void {
    if (!this.#automerge) return;

    console.log('Processing mutations:', mutations);

    this.#automerge.change((doc: any) => {
      console.log('changing');

      // Ensure domTree exists
      if (!doc.domTree) {
        doc.domTree = this.#serializeNode(this.ownerElement);
        return;
      }

      for (const mutation of mutations) {
        // Get the path to the affected node in the Automerge document
        const targetPath = this.#nodeToPath.get(mutation.target);
        if (!targetPath) continue;

        // Handle different mutation types
        switch (mutation.type) {
          case 'attributes': {
            // Find the node in the document
            let node = doc;
            for (const segment of targetPath) {
              node = node[segment];
            }

            // Update the attribute
            if (mutation.attributeName) {
              if (mutation.oldValue === null) {
                // Attribute was removed
                delete node.attributes[mutation.attributeName];
              } else {
                // Attribute was added or changed
                if (!node.attributes) node.attributes = {};
                const target = mutation.target as Element;
                node.attributes[mutation.attributeName] = target.getAttribute(mutation.attributeName) || '';
              }
            }
            break;
          }

          case 'characterData': {
            // Find the node in the document
            let node = doc;
            for (const segment of targetPath) {
              node = node[segment];
            }

            // Update the text content
            node.textContent = mutation.target.textContent || '';
            break;
          }

          case 'childList': {
            // Handle added nodes
            for (const addedNode of mutation.addedNodes) {
              // Find the parent node in the document
              let parentNode = doc;
              for (const segment of targetPath) {
                parentNode = parentNode[segment];
              }

              // Find the index where the node was inserted
              const childNodes = Array.from(mutation.target.childNodes);
              const index = childNodes.findIndex((child) => child === addedNode);
              if (index === -1) continue;

              // Create the new node path
              const newNodePath = [...targetPath, 'childNodes', index.toString()];

              // Serialize the added node
              const serializedNode = this.#serializeNode(addedNode, newNodePath.slice(1)); // Remove 'domTree'

              // Insert the node at the correct position
              parentNode.childNodes.splice(index, 0, serializedNode);

              // Update paths for all subsequent siblings
              for (let i = index + 1; i < mutation.target.childNodes.length; i++) {
                const sibling = mutation.target.childNodes[i];
                const oldPath = this.#nodeToPath.get(sibling);
                if (oldPath) {
                  const newPath = [...targetPath, 'childNodes', i.toString()];
                  this.#nodeToPath.set(sibling, newPath);
                  this.#pathToNode.delete(oldPath.join('.'));
                  this.#pathToNode.set(newPath.join('.'), sibling);
                }
              }
            }

            // Handle removed nodes
            for (const removedNode of mutation.removedNodes) {
              // Find the parent node in the document
              let parentNode = doc;
              for (const segment of targetPath) {
                parentNode = parentNode[segment];
              }

              // Find the index where the node was removed
              const removedPath = this.#nodeToPath.get(removedNode);
              if (!removedPath) continue;

              const removedIndex = parseInt(removedPath[removedPath.length - 1]);

              // Remove the node
              parentNode.childNodes.splice(removedIndex, 1);

              // Clean up our mappings
              this.#pathToNode.delete(removedPath.join('.'));
              this.#nodeToPath.delete(removedNode);

              // Update paths for all subsequent siblings
              for (let i = removedIndex; i < mutation.target.childNodes.length; i++) {
                const sibling = mutation.target.childNodes[i];
                const oldPath = this.#nodeToPath.get(sibling);
                if (oldPath) {
                  const newPath = [...targetPath, 'childNodes', i.toString()];
                  this.#nodeToPath.set(sibling, newPath);
                  this.#pathToNode.delete(oldPath.join('.'));
                  this.#pathToNode.set(newPath.join('.'), sibling);
                }
              }
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
  #handleDocumentChange(doc: any): void {
    console.log('Document changed:', doc);

    // Stop observing while we update the DOM
    this.#stopObserving();

    try {
      // Update the DOM tree to match the document
      // Use the domTree property if it exists, otherwise use the root document
      this.#deserializeNode(doc.domTree || doc, []);
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

    // Initialize FolkAutomerge for network sync
    this.#automerge = new FolkAutomerge<any>({});

    // When the document is ready, either initialize from the document or from the DOM
    this.#automerge.whenReady().then((doc) => {
      // Stop observing while we initialize
      this.#stopObserving();

      try {
        if (Object.keys(doc).length === 0) {
          // New document: serialize the DOM into the document
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
          this.#replaceDOMSubtree(doc.domTree || doc);
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
