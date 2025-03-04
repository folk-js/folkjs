import * as Automerge from '@automerge/automerge';
import { CustomAttribute, customAttributes } from '@lib';
import { v4 as uuidv4 } from 'uuid';

/**
 * Simplified CRDT DOM synchronization
 *
 * This implementation focuses only on attribute and text changes,
 * leaving node insertion, deletion, and moving for future implementation.
 */

// Simplified structure for representing DOM elements in the CRDT
export type NodeData = {
  // Element attributes stored as key-value pairs
  attributes?: { [key: string]: string };
  // Text content (only for text nodes)
  textContent?: string;
};

// Main document structure - a map of node IDs to their data
export type SyncDoc = {
  nodes: { [nodeId: string]: NodeData };
};

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

  // Automerge document
  #doc: Automerge.Doc<SyncDoc> = Automerge.init<SyncDoc>();

  // Map from DOM nodes to their IDs in the CRDT
  #nodeMap = new WeakMap<Node, string>();

  // Map from node IDs to DOM nodes for reverse lookup
  // Using Map instead of WeakMap to allow looking up by ID string
  #idToNodeMap = new Map<string, Node>();

  // MutationObserver instance
  #observer: MutationObserver | null = null;

  static define() {
    super.define();
  }

  // Configuration for the MutationObserver - only observing attributes and text
  #observerConfig = {
    attributes: true,
    characterData: true,
    subtree: true,
    attributeOldValue: true,
    characterDataOldValue: true,
  };

  /**
   * Handle mutations from the MutationObserver
   */
  #handleMutations(mutations: MutationRecord[]): void {
    for (const mutation of mutations) {
      try {
        if (mutation.type === 'attributes') {
          this.#handleAttributeMutation(mutation);
        } else if (mutation.type === 'characterData') {
          this.#handleTextMutation(mutation);
        }
        // Explicitly ignore childList mutations as per requirements
      } catch (error) {
        console.error('Error handling mutation:', error);
        // Fail early with clear error messages
        throw error;
      }
    }
  }

  /**
   * Handle attribute changes
   */
  #handleAttributeMutation(mutation: MutationRecord): void {
    const element = mutation.target as Element;
    const attributeName = mutation.attributeName!;
    const newValue = element.getAttribute(attributeName);

    // Skip our own attribute to avoid infinite loops
    if (attributeName === FolkSyncAttribute.attributeName) {
      return;
    }

    // Get or create node ID
    const nodeId = this.#getOrCreateNodeId(element);

    console.log(`📝 Updating attribute "${attributeName}" on element:`, {
      element: element.tagName,
      nodeId,
      oldValue: mutation.oldValue,
      newValue,
    });

    // Update the attribute in the CRDT
    this.#doc = Automerge.change(this.#doc, (doc) => {
      // Ensure nodeId is properly typed
      const id: string = nodeId;

      // Initialize node if needed
      if (!doc.nodes[id]) {
        doc.nodes[id] = {};
      }

      // Initialize attributes if needed
      if (!doc.nodes[id].attributes) {
        doc.nodes[id].attributes = {};
      }

      const nodeAttributes = doc.nodes[id].attributes!;

      if (newValue === null) {
        // Attribute was removed
        delete nodeAttributes[attributeName];
      } else {
        // Attribute was added or modified
        nodeAttributes[attributeName] = newValue;
      }
    });

    console.log(`✅ Updated attribute in CRDT: ${attributeName} ${newValue === null ? 'removed' : `= "${newValue}"`}`);
  }

  /**
   * Handle text content changes
   */
  #handleTextMutation(mutation: MutationRecord): void {
    const textNode = mutation.target as Text;
    const newContent = textNode.textContent || '';

    // Get or create node ID
    const nodeId = this.#getOrCreateNodeId(textNode);

    console.log(`📝 Updating text content:`, {
      nodeId,
      oldContent: mutation.oldValue,
      newContent: newContent.length > 50 ? newContent.substring(0, 47) + '...' : newContent,
      parentElement: textNode.parentElement?.tagName,
    });

    // Update the text content in the CRDT
    this.#doc = Automerge.change(this.#doc, (doc) => {
      // Ensure nodeId is properly typed
      const id: string = nodeId;

      if (!doc.nodes[id]) {
        doc.nodes[id] = {};
      }

      // For text nodes, we want to use splice for better merging
      // We would typically calculate a diff here, but for simplicity,
      // we're just replacing the entire content
      doc.nodes[id].textContent = newContent;

      // TODO: Implement proper diffing with Automerge.splice:
      // Example of how it would be implemented with diffing:
      // const oldContent = doc.nodes[id].textContent || '';
      // const diff = calculateTextDiff(oldContent, newContent);
      // for (const [index, deleteCount, insertedText] of diff) {
      //   Automerge.splice(doc.nodes[id], ['textContent'], index, deleteCount, insertedText);
      // }
    });

    console.log(`✅ Updated text content in CRDT (${newContent.length} characters)`);
  }

  /**
   * Get an existing node ID for a DOM node or create a new one
   */
  #getOrCreateNodeId(node: Node): string {
    let nodeId = this.#nodeMap.get(node);

    if (!nodeId) {
      // Create a new UUID for this node
      nodeId = uuidv4();

      // Log the node creation
      const nodeType =
        node.nodeType === Node.ELEMENT_NODE
          ? `Element <${(node as Element).tagName.toLowerCase()}>`
          : `Text "${(node.textContent || '').substring(0, 20)}${(node.textContent || '').length > 20 ? '...' : ''}"`;

      console.log(`🆕 Creating new CRDT node for ${nodeType} with ID: ${nodeId}`);

      // Store mapping in both directions
      this.#nodeMap.set(node, nodeId);
      this.#idToNodeMap.set(nodeId, node);

      // Initialize the node in the CRDT
      this.#doc = Automerge.change(this.#doc, (doc) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          // For elements, initialize with attributes
          const element = node as Element;
          const attributes: { [key: string]: string } = {};

          // Collect all attributes
          for (let i = 0; i < element.attributes.length; i++) {
            const attr = element.attributes[i];
            if (attr.name !== FolkSyncAttribute.attributeName) {
              attributes[attr.name] = attr.value;
            }
          }

          // Ensure nodeId is properly typed
          const id: string = nodeId as string;
          doc.nodes[id] = { attributes };

          console.log(`📊 Initialized element with ${Object.keys(attributes).length} attributes`);
        } else if (node.nodeType === Node.TEXT_NODE) {
          // For text nodes, initialize with text content
          const id: string = nodeId as string;
          const content = node.textContent || '';
          doc.nodes[id] = { textContent: content };

          console.log(`📝 Initialized text node with ${content.length} characters`);
        } else {
          throw new Error(`Unsupported node type: ${node.nodeType}`);
        }
      });
    }

    return nodeId;
  }

  /**
   * Apply changes from the CRDT to the DOM
   * This would be called when receiving updates from peers
   */
  applyExternalChanges(remoteDoc: Automerge.Doc<SyncDoc>): void {
    // Get the changes between our current doc and the remote doc
    const changes = Automerge.getChanges(this.#doc, remoteDoc);
    if (changes.length === 0) return;

    console.log(`📥 Received ${changes.length} external changes`);

    // Merge the changes into our document
    this.#stopObserving(); // Pause observation to avoid cycles
    try {
      // Get the document before the merge to compare changes
      const oldDoc = this.#doc;

      // Merge the remote changes into our document
      this.#doc = Automerge.merge(this.#doc, remoteDoc);

      console.log(`🔄 Merged changes into local document`);

      let attributeUpdateCount = 0;
      let textUpdateCount = 0;

      // Find what changed and apply to DOM
      // For each nodeId in the document
      for (const nodeId in this.#doc.nodes) {
        // Only process if this node was in both documents
        if (oldDoc.nodes[nodeId]) {
          // Find the corresponding DOM node
          // Note: In a real implementation, we'd need a reverse mapping from nodeId to DOM node
          const domNode = this.#findDOMNodeByNodeId(nodeId);

          if (domNode) {
            if (domNode.nodeType === Node.ELEMENT_NODE) {
              // Handle attribute changes
              const element = domNode as Element;
              const newAttrs = this.#doc.nodes[nodeId].attributes || {};
              const oldAttrs = oldDoc.nodes[nodeId].attributes || {};

              // Count the differences
              const attributeDiffs = this.#countAttributeDiffs(oldAttrs, newAttrs);
              if (attributeDiffs > 0) {
                attributeUpdateCount += attributeDiffs;
                console.log(`🔄 Applying ${attributeDiffs} attribute change(s) to ${element.tagName} element`);
              }

              // Update attributes that changed
              this.#updateElementAttributes(element, oldAttrs, newAttrs);
            } else if (domNode.nodeType === Node.TEXT_NODE) {
              // Handle text changes
              const textNode = domNode as Text;
              const newContent = this.#doc.nodes[nodeId].textContent || '';

              // Update text content if it changed
              if (textNode.textContent !== newContent) {
                textUpdateCount++;
                const oldContent = textNode.textContent || '';
                console.log(`🔄 Updating text content: ${oldContent.length} → ${newContent.length} characters`);
                textNode.textContent = newContent;
              }
            }
          } else {
            console.warn(`⚠️ Could not find DOM node for nodeId: ${nodeId}`);
          }
        }
      }

      console.log(
        `✅ Applied external changes: ${attributeUpdateCount} attribute updates, ${textUpdateCount} text updates`,
      );
    } finally {
      this.#startObserving(); // Resume observation
    }
  }

  /**
   * Helper method to find a DOM node by its node ID
   */
  #findDOMNodeByNodeId(nodeId: string): Node | null {
    // Use our reverse lookup map
    return this.#idToNodeMap.get(nodeId) || null;
  }

  /**
   * Helper method to update element attributes based on changes
   */
  #updateElementAttributes(
    element: Element,
    oldAttrs: { [key: string]: string },
    newAttrs: { [key: string]: string },
  ): void {
    // Remove attributes that were deleted
    for (const key in oldAttrs) {
      if (!(key in newAttrs)) {
        element.removeAttribute(key);
      }
    }

    // Add or update attributes
    for (const key in newAttrs) {
      const newValue = newAttrs[key];
      if (element.getAttribute(key) !== newValue) {
        element.setAttribute(key, newValue);
      }
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

  connectedCallback(): void {
    console.log(`🔌 FolkSync connected to <${this.ownerElement.tagName.toLowerCase()}>`);

    // Initialize the CRDT document with an empty nodes map
    this.#doc = Automerge.init<SyncDoc>();
    this.#doc = Automerge.change(this.#doc, (doc) => {
      doc.nodes = {};
    });

    console.log(`🏁 Initialized empty CRDT document`);

    // Scan and initialize all relevant nodes in the subtree
    console.log(`🔍 Starting scan of DOM subtree...`);
    this.#scanAndInitializeSubtree(this.ownerElement);

    // Log a summary of what was initialized
    const nodeCount = Object.keys(this.#doc.nodes).length;
    console.log(`✅ Initialized ${nodeCount} nodes in the CRDT document`);

    // Start observing mutations
    this.#startObserving();
    console.log(`👀 Started observing DOM mutations`);
  }

  /**
   * Scan and initialize all element and text nodes in the subtree
   */
  #scanAndInitializeSubtree(root: Node): void {
    // Create a nodeId for the root element
    this.#getOrCreateNodeId(root);

    // Initialize all child elements and text nodes recursively without using TreeWalker
    this.#recursivelyInitializeNodes(root);
  }

  /**
   * Recursively initialize all nodes in the subtree
   * This avoids the TreeWalker API which was causing linter issues
   */
  #recursivelyInitializeNodes(node: Node): void {
    // Create an ID for this node
    this.#getOrCreateNodeId(node);

    // Process child nodes if this is an element
    if (node.nodeType === Node.ELEMENT_NODE) {
      for (let i = 0; i < node.childNodes.length; i++) {
        const childNode = node.childNodes[i];

        // We only care about element and non-empty text nodes
        if (
          childNode.nodeType === Node.ELEMENT_NODE ||
          (childNode.nodeType === Node.TEXT_NODE && childNode.textContent && childNode.textContent.trim() !== '')
        ) {
          this.#recursivelyInitializeNodes(childNode);
        }
      }
    }
  }

  /**
   * Clean up resources when disconnected
   */
  disconnectedCallback(): void {
    console.log(`🔌 FolkSync disconnected from <${this.ownerElement.tagName.toLowerCase()}>`);

    // Stop observing mutations
    this.#stopObserving();
    console.log(`🛑 Stopped observing DOM mutations`);

    // Clean up the ID map (the WeakMap will be garbage collected automatically)
    const nodeCount = this.#idToNodeMap.size;
    this.#idToNodeMap.clear();
    console.log(`🧹 Cleared ${nodeCount} node mappings`);
  }

  /**
   * Helper to count attribute differences between old and new
   */
  #countAttributeDiffs(oldAttrs: { [key: string]: string }, newAttrs: { [key: string]: string }): number {
    let count = 0;

    // Count attributes that were removed
    for (const key in oldAttrs) {
      if (!(key in newAttrs)) {
        count++;
      }
    }

    // Count attributes that were added or changed
    for (const key in newAttrs) {
      if (!(key in oldAttrs) || oldAttrs[key] !== newAttrs[key]) {
        count++;
      }
    }

    return count;
  }
}
