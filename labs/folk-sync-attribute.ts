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

  // Store only paths in the node map - paths are index-based [childIndex, childIndex, ...]
  // Empty array means root element
  #nodeMap = new WeakMap<Element, number[]>();

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
      doc.root = this.#createDOMNodeTree(this.ownerElement);
    });

    console.log('Initialized CRDT for element:', this.ownerElement);
  }

  // Create a DOM node tree recursively
  #createDOMNodeTree(element: Element, path: number[] = []): DOMNode {
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

    // Store the path in the node map
    this.#nodeMap.set(element, path);

    const crdtNode: DOMNode = {
      tagName: element.tagName.toLowerCase(),
      attributes,
      textContent,
      children: [],
    };

    // Process element children recursively
    const elementChildren = Array.from(element.children);
    elementChildren.forEach((child, index) => {
      const childPath = [...path, index];
      const childNode = this.#createDOMNodeTree(child, childPath);
      crdtNode.children.push(childNode);
    });

    return crdtNode;
  }

  // Get a node from the CRDT by path
  #getNodeByPath(doc: SyncDoc, path: number[]): DOMNode {
    // Start at the root
    let node = doc.root;

    // Navigate through the path
    for (const index of path) {
      if (!node.children || index >= node.children.length) {
        throw new Error(`Invalid path: ${path.join(',')}`);
      }
      node = node.children[index];
    }

    return node;
  }

  // Get the path for a DOM element
  #getPathForElement(element: Element): number[] | undefined {
    return this.#nodeMap.get(element);
  }

  // Update paths for an element and all its descendants
  #updateElementPaths(element: Element) {
    const path = this.#getPathForElement(element);
    if (path === undefined) return;

    // Update children paths
    this.#updateElementChildPaths(element, path);
  }

  // Update an element's children paths
  #updateElementChildPaths(element: Element, parentPath: number[]) {
    const elementChildren = Array.from(element.children);
    elementChildren.forEach((child, index) => {
      const childPath = [...parentPath, index];

      // Update this child's path
      this.#nodeMap.set(child, childPath);

      // Recursively update grandchildren
      this.#updateElementChildPaths(child, childPath);
    });
  }

  // Simplified logging of a DOM node and its CRDT counterpart
  #logNodeComparison(element: Element, description: string) {
    const path = this.#getPathForElement(element);
    if (path === undefined) {
      console.log(`${description} - Element has no path:`, element);
      return;
    }

    try {
      const crdtNode = this.#getNodeByPath(this.#doc, path);
      console.log(`${description} - Path: [${path.join(',')}]`);
      console.log('  DOM:', {
        tagName: element.tagName.toLowerCase(),
        attributes: Array.from(element.attributes).reduce(
          (obj, attr) => {
            obj[attr.name] = attr.value;
            return obj;
          },
          {} as Record<string, string>,
        ),
        textContent: Array.from(element.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent)
          .join(''),
      });
      console.log('  CRDT:', {
        tagName: crdtNode.tagName,
        attributes: crdtNode.attributes,
        textContent: crdtNode.textContent,
        childrenCount: crdtNode.children.length,
      });
    } catch (e) {
      console.log(`${description} - Could not find CRDT node for path [${path.join(',')}]:`, e);
    }
  }

  // Handle DOM mutations and update the CRDT
  #handleMutations(mutations: MutationRecord[]) {
    if (mutations.length === 0) return;

    const affectedElements = new Set<Element>();

    // Process each mutation
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        const parentElement = mutation.target as Element;
        affectedElements.add(parentElement);
        this.#processChildListMutation(mutation);
      } else if (mutation.type === 'attributes') {
        const element = mutation.target as Element;
        affectedElements.add(element);
        this.#processAttributeMutation(mutation);
      } else if (mutation.type === 'characterData') {
        const textNode = mutation.target;
        const parentElement = textNode.parentElement;
        if (parentElement) {
          affectedElements.add(parentElement);
        }
        this.#processCharacterDataMutation(mutation);
      }
    }

    // Log the affected elements
    console.log(`--- Synced ${affectedElements.size} elements ---`);
    affectedElements.forEach((element) => {
      this.#logNodeComparison(element, 'Affected element');
    });
  }

  // Process a childList mutation (nodes added or removed)
  #processChildListMutation(mutation: MutationRecord) {
    // Get the parent element
    const parentElement = mutation.target as Element;
    if (!parentElement || parentElement.nodeType !== Node.ELEMENT_NODE) return;

    // Get the parent path
    const parentPath = this.#getPathForElement(parentElement);
    if (parentPath === undefined) return;

    // Update the CRDT
    this.#doc = Automerge.change(this.#doc, (doc) => {
      try {
        // Get the parent CRDT node
        const parentCrdtNode = this.#getNodeByPath(doc, parentPath);

        // Handle removed nodes
        if (mutation.removedNodes.length > 0) {
          this.#processRemovedNodes(mutation.removedNodes, parentElement, parentCrdtNode);
        }

        // Update text content if needed
        this.#updateNodeTextContent(parentElement, parentCrdtNode);

        // Handle added nodes
        if (mutation.addedNodes.length > 0) {
          this.#processAddedNodes(mutation.addedNodes, parentElement, parentCrdtNode, parentPath);
        }
      } catch (e) {
        console.error('Error processing childList mutation:', e);
      }
    });

    // Update paths for affected elements
    this.#updateElementPaths(parentElement);
  }

  // Process removed nodes
  #processRemovedNodes(removedNodes: NodeList, parentElement: Element, parentCrdtNode: DOMNode) {
    // Create a map of current children to their indices
    const childrenMap = new Map<Element, number>();
    Array.from(parentElement.children).forEach((child, index) => {
      childrenMap.set(child, index);
    });

    // Find and remove each node from the CRDT
    for (const removedNode of Array.from(removedNodes)) {
      // Skip non-element nodes
      if (removedNode.nodeType !== Node.ELEMENT_NODE) continue;

      const removedElement = removedNode as Element;
      const removedPath = this.#getPathForElement(removedElement);

      if (removedPath) {
        // Get the index of this node in its parent's children
        const lastIndex = removedPath[removedPath.length - 1];

        // Make sure the index is valid
        if (lastIndex < parentCrdtNode.children.length) {
          parentCrdtNode.children.splice(lastIndex, 1);
        } else {
          // Fall back to matching by tag name if the index is invalid
          const removedTag = removedElement.tagName.toLowerCase();

          // Find by tag name
          for (let i = 0; i < parentCrdtNode.children.length; i++) {
            if (parentCrdtNode.children[i].tagName.toLowerCase() === removedTag) {
              // Check if this element is still in the DOM
              let stillInDOM = false;
              for (const [domChild] of childrenMap) {
                const domChildPath = this.#getPathForElement(domChild);
                if (domChildPath && domChildPath[domChildPath.length - 1] === i) {
                  stillInDOM = true;
                  break;
                }
              }

              if (!stillInDOM) {
                parentCrdtNode.children.splice(i, 1);
                break;
              }
            }
          }
        }
      }
    }
  }

  // Process added nodes
  #processAddedNodes(addedNodes: NodeList, parentElement: Element, parentCrdtNode: DOMNode, parentPath: number[]) {
    // Get the current DOM children
    const currentChildren = Array.from(parentElement.children);

    for (const addedNode of Array.from(addedNodes)) {
      // Skip non-element nodes
      if (addedNode.nodeType !== Node.ELEMENT_NODE) continue;

      const addedElement = addedNode as Element;

      // Find the position of this element in the current children
      const position = currentChildren.indexOf(addedElement);
      if (position === -1) continue; // Not found in current children (might have been removed)

      // Create a path for this new node
      const childPath = [...parentPath, position];

      // Create the CRDT node for this element
      const newNode = this.#createDOMNodeTree(addedElement, childPath);

      // Insert at the correct position
      parentCrdtNode.children.splice(position, 0, newNode);
    }
  }

  // Process an attribute mutation
  #processAttributeMutation(mutation: MutationRecord) {
    const element = mutation.target as Element;
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return;

    const elementPath = this.#getPathForElement(element);
    if (elementPath === undefined) return;

    this.#doc = Automerge.change(this.#doc, (doc) => {
      try {
        const crdtNode = this.#getNodeByPath(doc, elementPath);

        const attrName = mutation.attributeName!;
        const newValue = element.getAttribute(attrName);

        if (newValue === null) {
          // Attribute was removed
          delete crdtNode.attributes[attrName];
        } else {
          // Attribute was added or modified
          crdtNode.attributes[attrName] = newValue;
        }
      } catch (e) {
        console.error('Error processing attribute mutation:', e);
      }
    });
  }

  // Process a characterData mutation (text content changed)
  #processCharacterDataMutation(mutation: MutationRecord) {
    // Find the parent element
    const textNode = mutation.target;
    const parentElement = textNode.parentElement;

    if (!parentElement) return;

    const parentPath = this.#getPathForElement(parentElement);
    if (parentPath === undefined) return;

    this.#doc = Automerge.change(this.#doc, (doc) => {
      try {
        const parentCrdtNode = this.#getNodeByPath(doc, parentPath);

        // Update the text content
        this.#updateNodeTextContent(parentElement, parentCrdtNode);
      } catch (e) {
        console.error('Error processing characterData mutation:', e);
      }
    });
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
