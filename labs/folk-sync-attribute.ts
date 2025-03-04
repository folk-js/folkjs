import * as Automerge from '@automerge/automerge';
import { CustomAttribute, customAttributes } from '@lib';

// Define the CRDT node structure
export type DOMNode = {
  type: 'element' | 'text';
  id: string;
  tagName?: string;
  attributes?: { [key: string]: string }; // Changed from Map to object
  textContent?: string;
  children: string[]; // Array of node IDs
};

// Define the document structure
export type SyncDoc = {
  nodes: { [id: string]: DOMNode }; // Changed from Map to object
  root: string;
};

declare global {
  interface Element {
    sync: FolkSyncAttribute | undefined;
  }
}

Object.defineProperty(Element.prototype, 'sync', {
  get() {
    return customAttributes.get(this, FolkSyncAttribute.attributeName) as FolkSyncAttribute | undefined;
  },
});

export class FolkSyncAttribute extends CustomAttribute {
  static attributeName = 'folk-sync';

  // Automerge document
  #doc: Automerge.Doc<SyncDoc> = Automerge.init<SyncDoc>();

  // Map of DOM nodes to their IDs in the CRDT
  #nodeMap = new WeakMap<Node, string>();

  // Counter for generating unique IDs
  #idCounter = 0;

  static define() {
    super.define();
  }

  // MutationObserver instance
  #observer: MutationObserver | null = null;

  // Configuration for the MutationObserver
  #observerConfig = {
    attributes: true,
    childList: true,
    characterData: true,
    subtree: true,
    attributeOldValue: true,
    characterDataOldValue: true,
  };

  // Method to start observing mutations
  #startObserving() {
    if (!this.#observer) {
      this.#observer = new MutationObserver((mutations) => this.#handleMutations(mutations));
    }
    this.#observer.observe(this.ownerElement, this.#observerConfig);
  }

  // Method to stop observing mutations
  #stopObserving() {
    if (this.#observer) {
      this.#observer.disconnect();
    }
  }

  // Generate a unique ID for a node
  #generateId(): string {
    return `node-${this.#idCounter++}`;
  }

  // Initialize the Automerge document
  #initializeDoc() {
    // Create a new Automerge document
    this.#doc = Automerge.init<SyncDoc>();

    // Create the initial structure with an empty nodes object
    this.#doc = Automerge.change(this.#doc, (doc) => {
      doc.nodes = {}; // Changed from Map to plain object
      // We'll set the root ID later when we process the DOM
    });

    // Process the DOM and build the initial CRDT representation
    this.#buildCRDTFromDOM();
  }

  // Build the CRDT representation from the current DOM state
  #buildCRDTFromDOM() {
    // Start from the element with the folk-sync attribute
    const rootElement = this.ownerElement;

    // Process the root element
    this.#doc = Automerge.change(this.#doc, (doc) => {
      const rootId = this.#processNode(rootElement, doc);
      doc.root = rootId;
    });

    // Log the initial state
    console.log('Initial CRDT state:', Automerge.dump(this.#doc));
  }

  // Process a DOM node and add it to the CRDT
  #processNode(node: Node, doc: SyncDoc): string {
    // Check if we've already processed this node
    const existingId = this.#nodeMap.get(node);
    if (existingId) return existingId;

    const id = this.#generateId();
    this.#nodeMap.set(node, id);

    if (node.nodeType === Node.TEXT_NODE) {
      // Handle text node
      doc.nodes[id] = {
        // Changed from Map.set to object property
        type: 'text',
        id,
        textContent: node.textContent || '',
        children: [],
      };
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      // Handle element node
      const elem = node as Element;
      const attributes: { [key: string]: string } = {}; // Changed from Map to object

      // Collect attributes
      for (const attr of Array.from(elem.attributes)) {
        attributes[attr.name] = attr.value; // Changed from Map.set to object property
      }

      // Create the node in the CRDT
      doc.nodes[id] = {
        // Changed from Map.set to object property
        type: 'element',
        id,
        tagName: elem.tagName.toLowerCase(),
        attributes,
        children: [],
      };

      // Process child nodes
      for (const child of Array.from(elem.childNodes)) {
        const childId = this.#processNode(child, doc);
        doc.nodes[id].children.push(childId);
      }
    }

    return id;
  }

  // Handle DOM mutations and update the CRDT
  #handleMutations(mutations: MutationRecord[]) {
    if (mutations.length === 0) return;

    this.#doc = Automerge.change(this.#doc, (doc) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          // Handle added nodes
          for (const node of Array.from(mutation.addedNodes)) {
            const parentId = this.#nodeMap.get(mutation.target);
            if (!parentId) continue;

            const nodeId = this.#processNode(node, doc);

            // Find the correct position to insert the node
            const parent = doc.nodes[parentId]; // Changed from Map.get to object property
            let nextSibling = node.nextSibling;
            while (nextSibling && !this.#nodeMap.has(nextSibling)) {
              nextSibling = nextSibling.nextSibling;
            }

            if (nextSibling) {
              const nextSiblingId = this.#nodeMap.get(nextSibling)!;
              const position = parent.children.indexOf(nextSiblingId);
              if (position !== -1) {
                parent.children.splice(position, 0, nodeId);
              } else {
                parent.children.push(nodeId);
              }
            } else {
              parent.children.push(nodeId);
            }
          }

          // Handle removed nodes
          for (const node of Array.from(mutation.removedNodes)) {
            const nodeId = this.#nodeMap.get(node);
            if (!nodeId) continue;

            const parentId = this.#nodeMap.get(mutation.target);
            if (!parentId) continue;

            const parent = doc.nodes[parentId]; // Changed from Map.get to object property
            const index = parent.children.indexOf(nodeId);
            if (index !== -1) {
              parent.children.splice(index, 1);
            }

            // Note: We're not deleting the node from the map or the CRDT
            // as it might be moved elsewhere in the DOM
          }
        } else if (mutation.type === 'attributes') {
          // Handle attribute changes
          const nodeId = this.#nodeMap.get(mutation.target);
          if (!nodeId) continue;

          const node = doc.nodes[nodeId]; // Changed from Map.get to object property
          if (!node || node.type !== 'element') continue;

          const attrName = mutation.attributeName!;
          const newValue = (mutation.target as Element).getAttribute(attrName);

          if (newValue === null) {
            // Attribute was removed
            delete node.attributes![attrName]; // Changed from Map.delete to delete operator
          } else {
            // Attribute was added or changed
            node.attributes![attrName] = newValue; // Changed from Map.set to object property
          }
        } else if (mutation.type === 'characterData') {
          // Handle text content changes
          const nodeId = this.#nodeMap.get(mutation.target);
          if (!nodeId) continue;

          const node = doc.nodes[nodeId]; // Changed from Map.get to object property
          if (!node) continue;

          node.textContent = mutation.target.textContent || '';
        }
      }
    });

    // Log changes
    console.log('CRDT state after mutations:', Automerge.dump(this.#doc));
  }

  connectedCallback(): void {
    // Initialize the Automerge document
    this.#initializeDoc();

    // Start observing mutations
    this.#startObserving();
  }

  disconnectedCallback(): void {
    // Stop observing mutations
    this.#stopObserving();
  }

  changedCallback(oldValue: string, newValue: string): void {
    // Handle attribute value changes if needed
  }
}
