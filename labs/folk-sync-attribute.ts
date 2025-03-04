import * as Automerge from '@automerge/automerge';
import { CustomAttribute, customAttributes } from '@lib';

// Define the CRDT node structure with a discriminated union for different node types
export type DOMTextNode = {
  type: 'text';
  textContent: string;
};

export type DOMElementNode = {
  type: 'element';
  tagName: string;
  attributes: { [key: string]: string };
  children: DOMNode[];
};

export type DOMNode = DOMTextNode | DOMElementNode;

// Define the document structure
export type SyncDoc = {
  root: DOMElementNode; // The root is always an element
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

  // Store paths in the node map - paths are index-based [childIndex, childIndex, ...]
  // Empty array means root element
  #nodeMap = new WeakMap<Node, number[]>();

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
      doc.root = this.#createDOMElementNode(this.ownerElement) as DOMElementNode;
    });

    console.log('Initialized CRDT for element:', this.ownerElement);
  }

  // Create a DOM node tree recursively
  #createDOMElementNode(element: Element, path: number[] = []): DOMElementNode {
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

    // Store the path in the node map
    this.#nodeMap.set(element, path);

    const elementNode: DOMElementNode = {
      type: 'element',
      tagName: element.tagName.toLowerCase(),
      attributes,
      children: [],
    };

    // Process all child nodes (both text and elements)
    const childNodes = Array.from(element.childNodes);
    let childIndex = 0;

    for (const childNode of childNodes) {
      if (childNode.nodeType === Node.TEXT_NODE) {
        const textContent = childNode.textContent || '';
        // Skip empty text nodes
        if (textContent.trim() === '') continue;

        const childPath = [...path, childIndex];
        const textNode: DOMTextNode = {
          type: 'text',
          textContent,
        };

        // Store the path for this text node
        this.#nodeMap.set(childNode, childPath);

        // Add to children array
        elementNode.children.push(textNode);
        childIndex++;
      } else if (childNode.nodeType === Node.ELEMENT_NODE) {
        const childPath = [...path, childIndex];
        const childElement = childNode as Element;
        const childElementNode = this.#createDOMElementNode(childElement, childPath);

        // Add to children array
        elementNode.children.push(childElementNode);
        childIndex++;
      }
      // Skip other node types (comments, etc.)
    }

    return elementNode;
  }

  // Create a text node for the CRDT
  #createDOMTextNode(textNode: Node, path: number[]): DOMTextNode {
    if (textNode.nodeType !== Node.TEXT_NODE) {
      throw new Error('Only text nodes can be processed by this method');
    }

    // Store the path in the node map
    this.#nodeMap.set(textNode, path);

    return {
      type: 'text',
      textContent: textNode.textContent || '',
    };
  }

  // Get a node from the CRDT by path
  #getNodeByPath(doc: SyncDoc, path: number[]): DOMNode {
    if (path.length === 0) {
      return doc.root; // Root node
    }

    // Start at the root
    let current: DOMNode = doc.root;

    // Navigate through the path
    for (let i = 0; i < path.length; i++) {
      const index = path[i];

      if (current.type !== 'element') {
        throw new Error(`Cannot navigate through text node at path: ${path.slice(0, i).join(',')}`);
      }

      if (!current.children || index >= current.children.length) {
        throw new Error(`Invalid path: ${path.join(',')}`);
      }

      current = current.children[index];
    }

    return current;
  }

  // Get the path for a DOM node
  #getPathForNode(node: Node): number[] | undefined {
    return this.#nodeMap.get(node);
  }

  // Ensure a node has a path and is tracked
  #ensureNodeTracked(node: Node): number[] | undefined {
    let path = this.#getPathForNode(node);
    if (path !== undefined) {
      return path;
    }

    // If this is a text node with a parent, we can try to infer its position
    if (node.nodeType === Node.TEXT_NODE && node.parentNode) {
      const parentNode = node.parentNode;
      const parentPath = this.#getPathForNode(parentNode);

      if (parentPath !== undefined) {
        // Rebuild the parent's children paths
        this.#rebuildChildPaths(parentNode, parentPath);

        // Check if the node got a path now
        path = this.#getPathForNode(node);
        if (path !== undefined) {
          return path;
        }

        // If still no path, try to find its position and add it
        const childNodes = Array.from(parentNode.childNodes);
        let position = -1;
        let childIndex = 0;

        for (const childNode of childNodes) {
          if (childNode.nodeType === Node.TEXT_NODE) {
            if ((childNode.textContent || '').trim() === '') continue;

            if (childNode === node) {
              position = childIndex;
              break;
            }
            childIndex++;
          } else if (childNode.nodeType === Node.ELEMENT_NODE) {
            childIndex++;
          }
        }

        if (position !== -1) {
          // Found the node's position, update the CRDT and track the node
          path = [...parentPath, position];
          this.#nodeMap.set(node, path);

          // Add the node to the CRDT at this position
          this.#doc = Automerge.change(this.#doc, (doc) => {
            try {
              const parentCrdtNode = this.#getNodeByPath(doc, parentPath);
              if (parentCrdtNode.type !== 'element') {
                throw new Error('Expected element node');
              }

              // Create text node
              const textNode: DOMTextNode = {
                type: 'text',
                textContent: node.textContent || '',
              };

              // If position would be at the end, just push
              if (position >= parentCrdtNode.children.length) {
                parentCrdtNode.children.push(textNode);
              } else {
                // Otherwise insert at the correct position
                parentCrdtNode.children.splice(position, 0, textNode);
              }
            } catch (e) {
              console.error('Error adding new text node to CRDT:', e);
            }
          });

          return path;
        }
      }
    }

    return undefined;
  }

  // Rebuild child paths for a parent node
  #rebuildChildPaths(parentNode: Node, parentPath: number[]) {
    const childNodes = Array.from(parentNode.childNodes);
    let childIndex = 0;

    for (const childNode of childNodes) {
      // Skip empty text nodes
      if (childNode.nodeType === Node.TEXT_NODE && (childNode.textContent || '').trim() === '') {
        continue;
      }

      if (childNode.nodeType === Node.TEXT_NODE || childNode.nodeType === Node.ELEMENT_NODE) {
        const childPath = [...parentPath, childIndex];

        // Update this child's path
        this.#nodeMap.set(childNode, childPath);

        // Recursively update grandchildren if this is an element
        if (childNode.nodeType === Node.ELEMENT_NODE) {
          this.#rebuildChildPaths(childNode, childPath);
        }

        childIndex++;
      }
    }
  }

  // Update paths for an element and all its descendants
  #updateElementPaths(element: Element) {
    const path = this.#getPathForNode(element);
    if (path === undefined) return;

    // Update children paths
    this.#rebuildChildPaths(element, path);
  }

  // Simplified logging of a DOM node and its CRDT counterpart
  #logNodeComparison(node: Node, description: string) {
    // Make sure the node is tracked before logging
    let path = this.#ensureNodeTracked(node);

    if (path === undefined) {
      console.log(`${description} - Failed to track node:`, node);
      return;
    }

    try {
      const crdtNode = this.#getNodeByPath(this.#doc, path);
      console.log(`${description} - Path: [${path.join(',')}]`);

      if (node.nodeType === Node.TEXT_NODE) {
        console.log('  DOM TEXT NODE:', {
          textContent: node.textContent,
        });
        console.log('  CRDT:', crdtNode);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as Element;
        console.log('  DOM ELEMENT:', {
          tagName: element.tagName.toLowerCase(),
          attributes: Array.from(element.attributes).reduce(
            (obj, attr) => {
              obj[attr.name] = attr.value;
              return obj;
            },
            {} as Record<string, string>,
          ),
          childrenCount: element.childNodes.length,
        });

        if (crdtNode.type === 'element') {
          console.log('  CRDT ELEMENT:', {
            tagName: crdtNode.tagName,
            attributes: crdtNode.attributes,
            childrenCount: crdtNode.children.length,
          });
        } else {
          console.log('  CRDT:', crdtNode); // Unexpected type
        }
      }
    } catch (e) {
      console.log(`${description} - Could not find CRDT node for path [${path.join(',')}]:`, e);
    }
  }

  // Handle DOM mutations and update the CRDT
  #handleMutations(mutations: MutationRecord[]) {
    if (mutations.length === 0) return;

    const affectedNodes = new Set<Node>();

    // Process each mutation
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        const parentElement = mutation.target as Element;
        affectedNodes.add(parentElement);

        // Track all added nodes
        for (const node of Array.from(mutation.addedNodes)) {
          if (this.#isSignificantNode(node)) {
            affectedNodes.add(node);
          }
        }

        this.#processChildListMutation(mutation);
      } else if (mutation.type === 'attributes') {
        const element = mutation.target as Element;
        affectedNodes.add(element);
        this.#processAttributeMutation(mutation);
      } else if (mutation.type === 'characterData') {
        const textNode = mutation.target;
        affectedNodes.add(textNode);
        this.#processCharacterDataMutation(mutation);
      }
    }

    // Log the affected nodes
    console.log(`--- Synced ${affectedNodes.size} nodes ---`);
    affectedNodes.forEach((node) => {
      this.#logNodeComparison(node, 'Affected node');
    });
  }

  // Check if a node is significant (not empty text, comment, etc.)
  #isSignificantNode(node: Node): boolean {
    if (node.nodeType === Node.ELEMENT_NODE) {
      return true;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      // Only count non-empty text nodes
      return (node.textContent || '').trim() !== '';
    }

    return false;
  }

  // Process a childList mutation (nodes added or removed)
  #processChildListMutation(mutation: MutationRecord) {
    // Get the parent element
    const parentElement = mutation.target as Element;
    if (!parentElement || parentElement.nodeType !== Node.ELEMENT_NODE) return;

    // Get the parent path
    const parentPath = this.#getPathForNode(parentElement);
    if (parentPath === undefined) return;

    // For childList mutations, completely rebuild the children array
    // to ensure proper synchronization between DOM and CRDT
    this.#doc = Automerge.change(this.#doc, (doc) => {
      try {
        // Get the parent CRDT node
        const parentCrdtNode = this.#getNodeByPath(doc, parentPath);
        if (parentCrdtNode.type !== 'element') {
          throw new Error('Expected element node');
        }

        // Clear the children array
        parentCrdtNode.children.splice(0, parentCrdtNode.children.length);

        // Rebuild the complete children array
        const childNodes = Array.from(parentElement.childNodes);
        let childIndex = 0;

        for (const childNode of childNodes) {
          if (this.#isSignificantNode(childNode)) {
            const childPath = [...parentPath, childIndex];

            // Update the path in the node map
            this.#nodeMap.set(childNode, childPath);

            if (childNode.nodeType === Node.TEXT_NODE) {
              // Create a text node
              const textNode: DOMTextNode = {
                type: 'text',
                textContent: childNode.textContent || '',
              };

              // Add to the CRDT
              parentCrdtNode.children.push(textNode);
            } else if (childNode.nodeType === Node.ELEMENT_NODE) {
              // Create an element node and add it
              const childElement = childNode as Element;
              const elementNode: DOMElementNode = {
                type: 'element',
                tagName: childElement.tagName.toLowerCase(),
                attributes: {},
                children: [],
              };

              // Copy attributes
              for (const attr of Array.from(childElement.attributes)) {
                elementNode.attributes[attr.name] = attr.value;
              }

              // Add to the CRDT
              parentCrdtNode.children.push(elementNode);

              // Recursively rebuild this element's children
              this.#rebuildElementChildren(childElement, childPath, doc);
            }

            childIndex++;
          }
        }
      } catch (e) {
        console.error('Error processing childList mutation:', e);
      }
    });

    // Update paths for all descendants
    this.#updateElementPaths(parentElement);
  }

  // Helper method to rebuild an element's children in the CRDT
  #rebuildElementChildren(element: Element, elementPath: number[], doc: Automerge.Doc<SyncDoc>) {
    try {
      const crdtNode = this.#getNodeByPath(doc, elementPath);
      if (crdtNode.type !== 'element') {
        throw new Error('Expected element node');
      }

      // Clear the children array
      crdtNode.children.splice(0, crdtNode.children.length);

      // Rebuild the complete children array
      const childNodes = Array.from(element.childNodes);
      let childIndex = 0;

      for (const childNode of childNodes) {
        if (this.#isSignificantNode(childNode)) {
          const childPath = [...elementPath, childIndex];

          // Update the path in the node map
          this.#nodeMap.set(childNode, childPath);

          if (childNode.nodeType === Node.TEXT_NODE) {
            // Create a text node
            const textNode: DOMTextNode = {
              type: 'text',
              textContent: childNode.textContent || '',
            };

            // Add to the CRDT
            crdtNode.children.push(textNode);
          } else if (childNode.nodeType === Node.ELEMENT_NODE) {
            // Create an element node and add it
            const childElement = childNode as Element;
            const elementNode: DOMElementNode = {
              type: 'element',
              tagName: childElement.tagName.toLowerCase(),
              attributes: {},
              children: [],
            };

            // Copy attributes
            for (const attr of Array.from(childElement.attributes)) {
              elementNode.attributes[attr.name] = attr.value;
            }

            // Add to the CRDT
            crdtNode.children.push(elementNode);

            // Recursively rebuild this element's children
            this.#rebuildElementChildren(childElement, childPath, doc);
          }

          childIndex++;
        }
      }
    } catch (e) {
      console.error('Error rebuilding element children:', e);
    }
  }

  // Process removed nodes - No longer needed, handled in processChildListMutation
  #processRemovedNodes(removedNodes: NodeList, parentElement: Element, parentCrdtNode: DOMElementNode) {
    // Implementation removed - now handled by complete rebuild in processChildListMutation
  }

  // Process added nodes - No longer needed, handled in processChildListMutation
  #processAddedNodes(
    addedNodes: NodeList,
    parentElement: Element,
    parentCrdtNode: DOMElementNode,
    parentPath: number[],
  ) {
    // Implementation removed - now handled by complete rebuild in processChildListMutation
  }

  // Process an attribute mutation
  #processAttributeMutation(mutation: MutationRecord) {
    const element = mutation.target as Element;
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return;

    const elementPath = this.#getPathForNode(element);
    if (elementPath === undefined) return;

    this.#doc = Automerge.change(this.#doc, (doc) => {
      try {
        const crdtNode = this.#getNodeByPath(doc, elementPath);
        if (crdtNode.type !== 'element') {
          throw new Error('Expected element node');
        }

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
    const textNode = mutation.target as Text;
    if (textNode.nodeType !== Node.TEXT_NODE) return;

    let textPath = this.#getPathForNode(textNode);

    // If the text node isn't tracked yet, try to track it
    if (textPath === undefined) {
      // Get the parent element and rebuild its children in the CRDT
      const parentNode = textNode.parentNode;
      if (parentNode && parentNode.nodeType === Node.ELEMENT_NODE) {
        const parentElement = parentNode as Element;
        const parentPath = this.#getPathForNode(parentElement);

        if (parentPath !== undefined) {
          // Process as if it were a childList mutation to ensure proper structure
          // Create a partial mutation record with just the properties we need
          const dummyMutation = {
            type: 'childList',
            target: parentElement,
            addedNodes: [],
            removedNodes: [],
          } as unknown as MutationRecord;

          this.#processChildListMutation(dummyMutation);

          // Try to get the path again
          textPath = this.#getPathForNode(textNode);
        }
      }

      if (textPath === undefined) {
        console.error('Still unable to track text node after parent rebuild:', textNode);
        return;
      }
    }

    // Now update the text content
    this.#doc = Automerge.change(this.#doc, (doc) => {
      try {
        const crdtNode = this.#getNodeByPath(doc, textPath!);
        if (crdtNode.type !== 'text') {
          throw new Error('Expected text node');
        }

        // Update the text content
        crdtNode.textContent = textNode.textContent || '';
      } catch (e) {
        console.error('Error processing characterData mutation:', e);
      }
    });
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
