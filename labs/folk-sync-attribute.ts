import * as Automerge from '@automerge/automerge';
import { CustomAttribute, customAttributes } from '@lib';

// Define the CRDT node structure as a recursive tree
export type DOMNode = {
  tagName: string;
  attributes: { [key: string]: string };
  textContent: string;
  children: DOMNode[]; // Directly nested children rather than IDs
};

// Define the document structure
export type SyncDoc = {
  root: DOMNode; // The root directly contains the entire tree
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

  // Map of DOM nodes to their corresponding CRDT nodes
  // This helps us find nodes to update when mutations occur
  #nodeMap = new WeakMap<
    Node,
    {
      path: (string | number)[]; // Path to the node in the CRDT tree
      node: DOMNode; // Reference to the node in the CRDT (updated after changes)
    }
  >();

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

  // Initialize the Automerge document
  #initializeDoc() {
    // Create the initial document with an empty root
    this.#doc = Automerge.change(this.#doc, (doc) => {
      // We'll build the tree structure directly from the DOM
      doc.root = this.#createDOMNodeTree(this.ownerElement);
    });

    console.log('initializing');
  }

  // Create a DOM node tree recursively
  #createDOMNodeTree(element: Element, path: (string | number)[] = ['root']): DOMNode {
    // Only process element nodes
    if (element.nodeType !== Node.ELEMENT_NODE) {
      throw new Error('Only element nodes should be processed');
    }

    // Create an element node
    const attributes: { [key: string]: string } = {};

    // Copy attributes
    for (const attr of Array.from(element.attributes)) {
      attributes[attr.name] = attr.value;
    }

    // Collect text content from direct text node children
    let textContent = '';
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        textContent += child.textContent || '';
      }
    }

    const crdtNode: DOMNode = {
      tagName: element.tagName.toLowerCase(),
      attributes,
      textContent,
      children: [],
    };

    // Process element children recursively
    const elementChildren = Array.from(element.children);
    elementChildren.forEach((child, index) => {
      const childPath = [...path, 'children', index];
      const childNode = this.#createDOMNodeTree(child, childPath);
      crdtNode.children.push(childNode);
    });

    // Store the mapping from DOM node to CRDT node
    this.#nodeMap.set(element, {
      path,
      node: crdtNode,
    });

    return crdtNode;
  }

  // Get a node from the CRDT by path
  #getNodeByPath(doc: SyncDoc, path: (string | number)[]): any {
    let current: any = doc;

    for (const segment of path) {
      if (current === undefined) return undefined;
      current = current[segment];
    }

    return current;
  }

  // Handle DOM mutations and update the CRDT
  #handleMutations(mutations: MutationRecord[]) {
    if (mutations.length === 0) return;

    this.#doc = Automerge.change(this.#doc, (doc) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          // Get the parent node's path
          const parentMapping = this.#nodeMap.get(mutation.target);
          if (!parentMapping) continue;

          const parentPath = parentMapping.path;
          const parentCrdtNode = this.#getNodeByPath(doc, parentPath);
          if (!parentCrdtNode) continue;

          // Handle removed nodes that are elements
          for (const removedNode of Array.from(mutation.removedNodes)) {
            // Skip non-element nodes
            if (removedNode.nodeType !== Node.ELEMENT_NODE) continue;

            const removedMapping = this.#nodeMap.get(removedNode);
            if (!removedMapping) continue;

            // Find the index of the removed child in the parent's children array
            const childIndex = parentCrdtNode.children.findIndex((child: DOMNode) => child === removedMapping.node);

            if (childIndex !== -1) {
              // Simply remove the child - Automerge will handle the deletion of the entire subtree
              parentCrdtNode.children.splice(childIndex, 1);
            }
          }

          // Update the text content if text nodes were added or removed
          this.#updateNodeTextContent(mutation.target as Element, parentCrdtNode);

          // Handle added nodes that are elements
          for (const addedNode of Array.from(mutation.addedNodes)) {
            // Skip non-element nodes
            if (addedNode.nodeType !== Node.ELEMENT_NODE) continue;

            // Find the position to insert
            let nextElementSibling = (addedNode as Element).nextElementSibling;
            let position = parentCrdtNode.children.length; // Default to appending

            // Find the correct position to insert
            while (nextElementSibling) {
              const siblingMapping = this.#nodeMap.get(nextElementSibling);
              if (siblingMapping) {
                const siblingIndex = parentCrdtNode.children.findIndex(
                  (child: DOMNode) => child === siblingMapping.node,
                );
                if (siblingIndex !== -1) {
                  position = siblingIndex;
                  break;
                }
              }
              nextElementSibling = nextElementSibling.nextElementSibling;
            }

            // Create the new node tree and insert it
            const childPath = [...parentPath, 'children', position];
            const newNode = this.#createDOMNodeTree(addedNode as Element, childPath);
            parentCrdtNode.children.splice(position, 0, newNode);

            // Update paths for all siblings after the insertion
            this.#updatePathsAfterInsertion(parentCrdtNode.children, position);
          }
        } else if (mutation.type === 'attributes') {
          // Find the node in the CRDT
          const nodeMapping = this.#nodeMap.get(mutation.target);
          if (!nodeMapping) continue;

          const nodePath = nodeMapping.path;
          const crdtNode = this.#getNodeByPath(doc, nodePath);
          if (!crdtNode) continue;

          const attrName = mutation.attributeName!;
          const newValue = (mutation.target as Element).getAttribute(attrName);

          if (newValue === null) {
            // Attribute was removed
            delete crdtNode.attributes[attrName];
          } else {
            // Attribute was added or modified
            crdtNode.attributes[attrName] = newValue;
          }
        } else if (mutation.type === 'characterData') {
          // Character data changes (text nodes)
          // Find the parent element
          const textNode = mutation.target;
          const parentElement = textNode.parentElement;

          if (!parentElement) continue;

          // Get the parent node mapping
          const parentMapping = this.#nodeMap.get(parentElement);
          if (!parentMapping) continue;

          // Update the text content for the parent element
          const parentCrdtNode = this.#getNodeByPath(doc, parentMapping.path);
          if (!parentCrdtNode) continue;

          this.#updateNodeTextContent(parentElement, parentCrdtNode);
        }
      }
    });

    // Update the node references in our map after changes
    this.#updateNodeMapReferences();
  }

  // Update text content for a node by collecting all direct text node children
  #updateNodeTextContent(element: Element, crdtNode: DOMNode) {
    let textContent = '';
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        textContent += child.textContent || '';
      }
    }
    crdtNode.textContent = textContent;
  }

  // Update path references for nodes after an insertion
  #updatePathsAfterInsertion(children: DOMNode[], startIndex: number) {
    // This updates path references in the nodeMap after insertions
    // In a production implementation, you'd iterate through affected nodes and update their paths
    // For simplicity, we're not implementing the full logic here
  }

  // Update node references in the nodeMap after a change
  #updateNodeMapReferences() {
    // After an Automerge change, the object references change
    // We need to update our nodeMap with the new references
    // In a production implementation, we would recursively walk the tree and update the references

    // For now, let's just rebuild the mapping for the next round of mutations
    // This is a simplification - a real implementation would be more efficient
    this.#rebuildNodeMap(this.ownerElement, this.#doc.root, ['root']);
  }

  // Rebuild the node map by walking the DOM and CRDT trees in parallel
  #rebuildNodeMap(domNode: Element, crdtNode: DOMNode, path: (string | number)[]) {
    // Map this node
    this.#nodeMap.set(domNode, {
      path,
      node: crdtNode,
    });

    // Map the children
    const domChildren = Array.from(domNode.children);

    // Map each child that exists in both DOM and CRDT
    for (let i = 0; i < Math.min(domChildren.length, crdtNode.children.length); i++) {
      const childPath = [...path, 'children', i];
      this.#rebuildNodeMap(domChildren[i], crdtNode.children[i], childPath);
    }
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
}
