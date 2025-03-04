import * as Automerge from '@automerge/automerge';
import { CustomAttribute, customAttributes } from '@lib';

/**
 * A simplified CRDT DOM synchronization proof-of-concept
 *
 * This implementation focuses only on:
 * 1. Text content changes (e.g. via contenteditable)
 * 2. Attribute changes (modifying values only, not adding/removing elements)
 *
 * It uses path-based IDs for tracking node relationships between DOM and CRDT.
 */

// Type-safe union of all DOM node type constants
// Using native Node constants instead of our own enum
export type DOMNodeTypeValue =
  | typeof Node.ELEMENT_NODE // 1
  | typeof Node.ATTRIBUTE_NODE // 2
  | typeof Node.TEXT_NODE // 3
  | typeof Node.CDATA_SECTION_NODE // 4
  | typeof Node.ENTITY_REFERENCE_NODE // 5 (deprecated)
  | typeof Node.ENTITY_NODE // 6 (deprecated)
  | typeof Node.PROCESSING_INSTRUCTION_NODE // 7
  | typeof Node.COMMENT_NODE // 8
  | typeof Node.DOCUMENT_NODE // 9
  | typeof Node.DOCUMENT_TYPE_NODE // 10
  | typeof Node.DOCUMENT_FRAGMENT_NODE // 11
  | typeof Node.NOTATION_NODE; // 12 (deprecated)

// Base interface for all DOM node types in our CRDT
export interface BaseDOMNode {
  type: DOMNodeTypeValue;
  path: string; // Path-based ID format: "0-1-2" (child indexes from root) used for mapping between DOM and CRDT before any changes are made
}

// Element node representation
export interface ElementNode extends BaseDOMNode {
  type: typeof Node.ELEMENT_NODE;
  tagName: string;
  attributes: { [key: string]: string };
}

// Text node representation
export interface TextNode extends BaseDOMNode {
  type: typeof Node.TEXT_NODE;
  textContent: string;
}

// Comment node representation (stub)
export interface CommentNode extends BaseDOMNode {
  type: typeof Node.COMMENT_NODE;
}

// Document node representation (stub)
export interface DocumentNode extends BaseDOMNode {
  type: typeof Node.DOCUMENT_NODE;
}

// Document type node representation (stub)
export interface DocumentTypeNode extends BaseDOMNode {
  type: typeof Node.DOCUMENT_TYPE_NODE;
}

// Document fragment node representation (stub)
export interface DocumentFragmentNode extends BaseDOMNode {
  type: typeof Node.DOCUMENT_FRAGMENT_NODE;
}

// Attribute node representation (stub)
export interface AttributeNode extends BaseDOMNode {
  type: typeof Node.ATTRIBUTE_NODE;
  name: string;
  value: string;
}

// CDATA Section node representation (stub)
export interface CDATASectionNode extends BaseDOMNode {
  type: typeof Node.CDATA_SECTION_NODE;
  textContent: string;
}

// Processing Instruction node representation (stub)
export interface ProcessingInstructionNode extends BaseDOMNode {
  type: typeof Node.PROCESSING_INSTRUCTION_NODE;
  target: string;
  data: string;
}

// Entity Reference node representation (stub, deprecated)
export interface EntityReferenceNode extends BaseDOMNode {
  type: typeof Node.ENTITY_REFERENCE_NODE;
}

// Entity node representation (stub, deprecated)
export interface EntityNode extends BaseDOMNode {
  type: typeof Node.ENTITY_NODE;
}

// Notation node representation (stub, deprecated)
export interface NotationNode extends BaseDOMNode {
  type: typeof Node.NOTATION_NODE;
}

// Union type for all DOM node types
export type DOMNode =
  | ElementNode
  | TextNode
  | CommentNode
  | DocumentNode
  | DocumentTypeNode
  | DocumentFragmentNode
  | AttributeNode
  | CDATASectionNode
  | ProcessingInstructionNode
  | EntityReferenceNode
  | EntityNode
  | NotationNode;

// Main document structure for the CRDT
export interface SyncDoc {
  nodes: { [path: string]: DOMNode };
}

// Define the custom element for extension
declare global {
  interface Element {
    sync: FolkSyncAttribute | undefined;
  }
}

// Extension method to easily get the sync object for an element
Object.defineProperty(Element.prototype, 'sync', {
  get() {
    return this.getAttribute(FolkSyncAttribute.attributeName)
      ? customAttributes.get(this, FolkSyncAttribute.attributeName)
      : undefined;
  },
});

export class FolkSyncAttribute extends CustomAttribute {
  static attributeName = 'folk-sync';

  // The Automerge document that will store our CRDT state
  #doc: Automerge.Doc<SyncDoc> = Automerge.init<SyncDoc>();

  // Map from DOM paths to DOM nodes for quick lookup
  #pathToNodeMap = new Map<string, Node>();

  // MutationObserver instance
  #observer: MutationObserver | null = null;

  // Configuration for the MutationObserver - only observing attributes and text
  #observerConfig = {
    attributes: true,
    characterData: true,
    subtree: true,
    attributeOldValue: true,
    characterDataOldValue: true,
  };

  // Define the custom attribute
  static define() {
    super.define();
  }

  /**
   * Generates a path-based ID for a DOM node
   * Format: "0-1-2" representing child indexes from root
   */
  #generatePathId(node: Node): string {
    const path: number[] = [];

    // Walk up the tree to build the path
    let current: Node | null = node;
    while (current && current !== this.ownerElement) {
      const parent: Node | null = current.parentNode;
      if (!parent) break;

      // Find the index of the current node among its siblings
      let index = 0;
      for (let i = 0; i < parent.childNodes.length; i++) {
        if (parent.childNodes[i] === current) {
          index = i;
          break;
        }
      }

      path.unshift(index);
      current = parent;
    }

    // Convert the array of indexes to a string path
    return path.join('-');
  }

  /**
   * Find a DOM node by its path ID
   */
  #findNodeByPath(path: string): Node | null {
    // Check our cache first
    if (this.#pathToNodeMap.has(path)) {
      return this.#pathToNodeMap.get(path) || null;
    }

    // Parse the path into an array of child indexes
    const indexes = path.split('-').map(Number);

    // Start from the root element and traverse the path
    let current: Node = this.ownerElement;
    for (const index of indexes) {
      if (current.childNodes.length <= index) {
        console.warn(`Path ${path} is invalid: child index ${index} out of bounds`);
        return null;
      }
      current = current.childNodes[index];
    }

    // Cache the result for future lookups
    this.#pathToNodeMap.set(path, current);

    return current;
  }

  /**
   * Setup CRDT change listeners to update the DOM when CRDT changes
   */
  #setupCRDTChangeListeners(): void {
    // Store the current document for comparison
    let previousDoc = this.#doc;

    // Listen for local changes by overriding the change method
    const originalChange = this.change.bind(this);
    this.change = (changeFn: (doc: SyncDoc) => void): void => {
      // Call the original method to apply the change
      originalChange(changeFn);

      // After the change is applied, compare and update
      this.#applyChangesFromCRDT(previousDoc, this.#doc);

      // Update previous doc reference
      previousDoc = this.#doc;
    };

    // For remote changes, we need to set up a method to be called
    // when the document is updated from an external source
    this.applyRemoteChanges = (remoteDoc: Automerge.Doc<SyncDoc>): void => {
      // Merge the remote changes into our document
      const oldDoc = this.#doc;
      this.#doc = Automerge.merge(this.#doc, remoteDoc);

      // Apply the changes to the DOM
      this.#applyChangesFromCRDT(oldDoc, this.#doc);

      // Update our reference
      previousDoc = this.#doc;
    };

    console.log('Registered change listeners for local and remote updates');
  }

  /**
   * Get a CRDT node by its path, if it exists
   */
  #getCRDTNode(path: string): DOMNode | undefined {
    return this.#doc.nodes[path];
  }

  /**
   * Create a new CRDT node for a DOM node
   */
  #createCRDTNode(domNode: Node): DOMNode {
    // Generate the path ID for this node
    const path = this.#generatePathId(domNode);

    // Node doesn't exist in CRDT, create it based on its type
    return this.#createCRDTNodeFromDOM(domNode, path);
  }

  /**
   * Create a new CRDT node from a DOM node
   */
  #createCRDTNodeFromDOM(domNode: Node, path: string): DOMNode {
    // Create different node types based on the DOM node type
    switch (domNode.nodeType) {
      case Node.ELEMENT_NODE: {
        const element = domNode as Element;
        const attributes: { [key: string]: string } = {};

        // Collect all attributes except our own sync attribute
        for (let i = 0; i < element.attributes.length; i++) {
          const attr = element.attributes[i];
          if (attr.name !== FolkSyncAttribute.attributeName) {
            attributes[attr.name] = attr.value;
          }
        }

        // Create the element node
        const node: ElementNode = {
          type: Node.ELEMENT_NODE,
          path,
          tagName: element.tagName.toLowerCase(),
          attributes,
        };

        // Add the node to the CRDT
        this.#doc = Automerge.change(this.#doc, (doc) => {
          doc.nodes[path] = node;
        });

        console.log(`Created ElementNode for <${element.tagName.toLowerCase()}> with path ${path}`);
        return node;
      }

      case Node.TEXT_NODE: {
        const textContent = domNode.textContent || '';

        // Create the text node
        const node: TextNode = {
          type: Node.TEXT_NODE,
          path,
          textContent,
        };

        // Add the node to the CRDT
        this.#doc = Automerge.change(this.#doc, (doc) => {
          doc.nodes[path] = node;
        });

        console.log(`Created TextNode with path ${path} and ${textContent.length} characters`);
        return node;
      }

      case Node.COMMENT_NODE: {
        const node: CommentNode = {
          type: Node.COMMENT_NODE,
          path,
        };

        this.#doc = Automerge.change(this.#doc, (doc) => {
          doc.nodes[path] = node;
        });

        console.log(`Created CommentNode stub with path ${path}`);
        return node;
      }

      case Node.DOCUMENT_NODE: {
        const node: DocumentNode = {
          type: Node.DOCUMENT_NODE,
          path,
        };

        this.#doc = Automerge.change(this.#doc, (doc) => {
          doc.nodes[path] = node;
        });

        console.log(`Created DocumentNode stub with path ${path}`);
        return node;
      }

      case Node.DOCUMENT_TYPE_NODE: {
        const node: DocumentTypeNode = {
          type: Node.DOCUMENT_TYPE_NODE,
          path,
        };

        this.#doc = Automerge.change(this.#doc, (doc) => {
          doc.nodes[path] = node;
        });

        console.log(`Created DocumentTypeNode stub with path ${path}`);
        return node;
      }

      case Node.DOCUMENT_FRAGMENT_NODE: {
        const node: DocumentFragmentNode = {
          type: Node.DOCUMENT_FRAGMENT_NODE,
          path,
        };

        this.#doc = Automerge.change(this.#doc, (doc) => {
          doc.nodes[path] = node;
        });

        console.log(`Created DocumentFragmentNode stub with path ${path}`);
        return node;
      }

      // For all other node types, create a generic node
      default: {
        // Log the unsupported node type
        console.log(`Creating a generic node for unsupported type ${domNode.nodeType} with path ${path}`);

        // For unsupported types, create a base node with the type
        let nodeType: DOMNodeTypeValue;

        // Safely cast to a supported node type or use ELEMENT_NODE as fallback
        if (domNode.nodeType === Node.ATTRIBUTE_NODE) {
          nodeType = Node.ATTRIBUTE_NODE;
        } else if (domNode.nodeType === Node.CDATA_SECTION_NODE) {
          nodeType = Node.CDATA_SECTION_NODE;
        } else if (domNode.nodeType === Node.ENTITY_REFERENCE_NODE) {
          nodeType = Node.ENTITY_REFERENCE_NODE;
        } else if (domNode.nodeType === Node.ENTITY_NODE) {
          nodeType = Node.ENTITY_NODE;
        } else if (domNode.nodeType === Node.PROCESSING_INSTRUCTION_NODE) {
          nodeType = Node.PROCESSING_INSTRUCTION_NODE;
        } else if (domNode.nodeType === Node.NOTATION_NODE) {
          nodeType = Node.NOTATION_NODE;
        } else {
          // Default to ELEMENT_NODE if we encounter an unknown type
          nodeType = Node.ELEMENT_NODE;
          console.warn(`Unknown node type ${domNode.nodeType}, defaulting to ELEMENT_NODE`);
        }

        // Create a basic node with just the type and path
        const node: BaseDOMNode = {
          type: nodeType,
          path,
        };

        // Add it to the CRDT
        this.#doc = Automerge.change(this.#doc, (doc) => {
          doc.nodes[path] = node as DOMNode;
        });

        return node as DOMNode;
      }
    }
  }

  /**
   * Handle DOM mutations observed by MutationObserver
   */
  #handleMutations(mutations: MutationRecord[]): void {
    // Process each mutation
    for (const mutation of mutations) {
      try {
        if (mutation.type === 'attributes') {
          this.#handleAttributeMutation(mutation);
        } else if (mutation.type === 'characterData') {
          this.#handleTextMutation(mutation);
        }
        // Ignoring childList mutations as per requirements
      } catch (error) {
        console.error('Error handling mutation:', error);
        throw error;
      }
    }
  }

  /**
   * Handle attribute changes in the DOM
   */
  #handleAttributeMutation(mutation: MutationRecord): void {
    const element = mutation.target as Element;
    const attributeName = mutation.attributeName!;
    const newValue = element.getAttribute(attributeName);

    // Skip our own attribute to avoid infinite loops
    if (attributeName === FolkSyncAttribute.attributeName) {
      return;
    }

    // Get the path for this element
    const path = this.#generatePathId(element);

    console.log(`Attribute change detected: "${attributeName}" on element at path ${path}`);

    // Check if we already have this node
    const existingNode = this.#getCRDTNode(path);

    // Update the attribute in the CRDT
    this.#doc = Automerge.change(this.#doc, (doc) => {
      if (!existingNode) {
        // This could happen if we missed the initial scan
        // Initialize it as an ElementNode
        doc.nodes[path] = {
          type: Node.ELEMENT_NODE,
          path,
          tagName: element.tagName.toLowerCase(),
          attributes: {},
        };
      }

      // Ensure we're working with an ElementNode
      const node = doc.nodes[path] as ElementNode;
      if (node.type !== Node.ELEMENT_NODE) {
        console.error(`Node at path ${path} is not an ElementNode`);
        return;
      }

      // Update the attribute
      if (newValue === null) {
        // Don't actually delete for this POC, as per requirements
        // only focusing on changing values, not adding/removing
        node.attributes[attributeName] = '';
      } else {
        node.attributes[attributeName] = newValue;
      }
    });
  }

  /**
   * Handle text content changes in the DOM
   */
  #handleTextMutation(mutation: MutationRecord): void {
    const textNode = mutation.target as Text;
    const newContent = textNode.textContent || '';

    // Get the path for this text node
    const path = this.#generatePathId(textNode);

    console.log(`Text change detected at path ${path}: ${newContent.length} characters`);

    // Check if we already have this node
    const existingNode = this.#getCRDTNode(path);

    // Update the text content in the CRDT
    this.#doc = Automerge.change(this.#doc, (doc) => {
      if (!existingNode) {
        // Initialize it as a TextNode if it doesn't exist
        doc.nodes[path] = {
          type: Node.TEXT_NODE,
          path,
          textContent: newContent,
        };
      } else {
        // Update existing text node
        const node = doc.nodes[path] as TextNode;
        if (node.type !== Node.TEXT_NODE) {
          console.error(`Node at path ${path} is not a TextNode`);
          return;
        }

        // Update the text content
        node.textContent = newContent;
      }
    });
  }

  /**
   * Apply changes from the CRDT to the DOM
   */
  #applyChangesFromCRDT(oldDoc: Automerge.Doc<SyncDoc>, newDoc: Automerge.Doc<SyncDoc>): void {
    // Stop observing to prevent loops
    this.#stopObserving();

    try {
      // Process each node in the new document
      for (const path in newDoc.nodes) {
        const newNode = newDoc.nodes[path];
        const oldNode = oldDoc.nodes[path];

        // Skip if node hasn't changed
        if (oldNode && JSON.stringify(oldNode) === JSON.stringify(newNode)) {
          continue;
        }

        // Find the corresponding DOM node
        const domNode = this.#findNodeByPath(path);
        if (!domNode) {
          console.warn(`Could not find DOM node for path: ${path}`);
          continue;
        }

        // Apply changes based on node type
        this.#applyNodeChanges(domNode, oldNode, newNode);
      }
    } finally {
      // Resume observation
      this.#startObserving();
    }
  }

  /**
   * Apply changes to a specific DOM node based on CRDT changes
   */
  #applyNodeChanges(domNode: Node, oldNode: DOMNode | undefined, newNode: DOMNode): void {
    // Use a visitor pattern to handle different node types
    switch (newNode.type) {
      case Node.ELEMENT_NODE:
        this.#applyElementChanges(domNode as Element, oldNode as ElementNode | undefined, newNode as ElementNode);
        break;

      case Node.TEXT_NODE:
        this.#applyTextChanges(domNode as Text, oldNode as TextNode | undefined, newNode as TextNode);
        break;

      // Stubs for other node types - no implementation needed for POC
      case Node.COMMENT_NODE:
      case Node.DOCUMENT_NODE:
      case Node.DOCUMENT_TYPE_NODE:
      case Node.DOCUMENT_FRAGMENT_NODE:
      case Node.ATTRIBUTE_NODE:
      case Node.CDATA_SECTION_NODE:
      case Node.PROCESSING_INSTRUCTION_NODE:
      case Node.ENTITY_REFERENCE_NODE:
      case Node.ENTITY_NODE:
      case Node.NOTATION_NODE:
        console.log(`Skipping changes for node type ${newNode.type} - not implemented in POC`);
        break;
    }
  }

  /**
   * Apply changes to an element node
   */
  #applyElementChanges(element: Element, oldNode: ElementNode | undefined, newNode: ElementNode): void {
    // Skip if no old node (new element) or no attributes change
    if (!oldNode || !oldNode.attributes) return;

    // Update attributes that changed
    for (const key in newNode.attributes) {
      const newValue = newNode.attributes[key];
      const oldValue = oldNode.attributes[key];

      // Update if changed
      if (oldValue !== newValue && element.getAttribute(key) !== newValue) {
        console.log(`Updating attribute ${key} on element ${element.tagName}: "${oldValue}" -> "${newValue}"`);
        element.setAttribute(key, newValue);
      }
    }
  }

  /**
   * Apply changes to a text node
   */
  #applyTextChanges(textNode: Text, oldNode: TextNode | undefined, newNode: TextNode): void {
    // Skip if content hasn't changed
    if (oldNode && oldNode.textContent === newNode.textContent) return;

    // Update text content
    if (textNode.textContent !== newNode.textContent) {
      console.log(
        `Updating text node content: ${textNode.textContent?.length || 0} -> ${newNode.textContent.length} chars`,
      );
      textNode.textContent = newNode.textContent;
    }
  }

  /**
   * Start observing DOM mutations
   */
  #startObserving(): void {
    if (!this.#observer) {
      this.#observer = new MutationObserver((mutations) => this.#handleMutations(mutations));
    }
    this.#observer.observe(this.ownerElement, this.#observerConfig);
    console.log('Started observing DOM mutations');
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
   * Get the current CRDT document
   */
  getDocument(): Automerge.Doc<SyncDoc> {
    return this.#doc;
  }

  /**
   * Apply a change to the document using Automerge.change
   */
  change(changeFn: (doc: SyncDoc) => void): void {
    this.#doc = Automerge.change(this.#doc, changeFn);
  }

  /**
   * Initialize when the attribute is connected to the DOM
   */
  connectedCallback(): void {
    console.log(`FolkSync connected to <${this.ownerElement.tagName.toLowerCase()}>`);

    // Initialize empty document
    this.#doc = Automerge.init<SyncDoc>();
    this.#doc = Automerge.change(this.#doc, (doc) => {
      doc.nodes = {};
    });

    console.log('Initialized empty CRDT document');

    // Scan and initialize the DOM subtree using TreeWalker
    console.log('Starting scan of DOM subtree...');

    // Create a CRDT node for the root element
    this.#createCRDTNode(this.ownerElement);

    // Use TreeWalker to efficiently traverse all nodes
    const walker = document.createTreeWalker(
      this.ownerElement,
      // Focus on elements and text nodes for this POC
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node: Node) => {
          // Only process text nodes with actual content
          if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent && node.textContent.trim() !== ''
              ? NodeFilter.FILTER_ACCEPT
              : NodeFilter.FILTER_SKIP;
          }
          // Accept all elements
          return NodeFilter.FILTER_ACCEPT;
        },
      },
    );

    // Skip the root node since we already processed it
    let currentNode = walker.nextNode();

    // Traverse all nodes in the subtree
    while (currentNode) {
      // Create new CRDT nodes for each DOM node
      // We know these are new nodes since we're initializing the document
      const node = this.#createCRDTNode(currentNode);

      // Store the mapping from path to node
      const path = this.#generatePathId(currentNode);
      this.#pathToNodeMap.set(path, currentNode);

      // Move to the next node
      currentNode = walker.nextNode();
    }

    console.log(`Initialized ${Object.keys(this.#doc.nodes).length} nodes in the CRDT document`);

    // Set up CRDT change listeners
    this.#setupCRDTChangeListeners();

    // Start observing mutations
    this.#startObserving();
  }

  /**
   * Clean up when the attribute is removed from the DOM
   */
  disconnectedCallback(): void {
    console.log(`FolkSync disconnected from <${this.ownerElement.tagName.toLowerCase()}>`);

    // Stop observing mutations
    this.#stopObserving();

    // Clear the path map
    this.#pathToNodeMap.clear();
  }

  /**
   * Apply remote changes from another peer
   * This should be called when receiving updates from a network connection
   */
  applyRemoteChanges(remoteDoc: Automerge.Doc<SyncDoc>): void {
    // Implementation is set up in setupCRDTChangeListeners
    // This stub is replaced at runtime
  }
}
