import * as Automerge from '@automerge/automerge';
import { CustomAttribute, customAttributes } from '@lib';
import { v4 as uuidv4 } from 'uuid';

// Define the CRDT node structure with a discriminated union for different node types
export type DOMTextNode = {
  id: string; // Unique ID for the node
  type: 'text';
  textContent: string;
};

export type DOMElementNode = {
  id: string; // Unique ID for the node
  type: 'element';
  tagName: string;
  attributes: { [key: string]: string };
  children: string[]; // Array of child IDs instead of nested objects
};

export type DOMNode = DOMTextNode | DOMElementNode;

// Define the document structure
export type SyncDoc = {
  root: DOMElementNode; // The root is always an element
  // Map of all nodes by ID
  nodes: { [id: string]: DOMNode };
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

  // Bidirectional mapping between DOM nodes and CRDT node IDs
  #domToNodeId = new WeakMap<Node, string>();
  #nodeIdToDom = new Map<string, Node>();

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
    // Create the initial document with an empty root and nodes map
    this.#doc = Automerge.change(this.#doc, (doc) => {
      // Initialize nodes map
      doc.nodes = {};

      // Create the root element
      const rootId = uuidv4();
      const root: DOMElementNode = {
        id: rootId,
        type: 'element',
        tagName: this.ownerElement.tagName.toLowerCase(),
        attributes: {},
        children: [],
      };

      // Copy attributes from the root element
      for (const attr of Array.from(this.ownerElement.attributes)) {
        // Skip the folk-sync attribute itself
        if (attr.name !== FolkSyncAttribute.attributeName) {
          root.attributes[attr.name] = attr.value;
        }
      }

      // Add root to nodes map
      doc.nodes[rootId] = root;
      doc.root = root;

      // Store the mapping from DOM to node ID
      this.#domToNodeId.set(this.ownerElement, rootId);
      this.#nodeIdToDom.set(rootId, this.ownerElement);

      // Build the complete DOM tree
      this.#buildDOMTree(this.ownerElement, doc, rootId);
    });

    console.log('Initialized CRDT for element:', this.ownerElement);
    // Log the entire document structure for debugging
    console.log('CRDT Document Structure:', JSON.parse(JSON.stringify(this.#doc)));
  }

  // Build the DOM tree recursively
  #buildDOMTree(element: Element, doc: SyncDoc, parentId: string): void {
    // Process all child nodes (both text and elements)
    const childNodes = Array.from(element.childNodes);

    for (const childNode of childNodes) {
      if (!this.#isSignificantNode(childNode)) continue;

      if (childNode.nodeType === Node.TEXT_NODE) {
        // Create a unique ID for this text node
        const nodeId = uuidv4();
        const textNode: DOMTextNode = {
          id: nodeId,
          type: 'text',
          textContent: childNode.textContent || '',
        };

        // Store the mapping
        this.#domToNodeId.set(childNode, nodeId);
        this.#nodeIdToDom.set(nodeId, childNode);

        // Add to nodes map
        doc.nodes[nodeId] = textNode;

        // Add to parent's children array
        const parent = doc.nodes[parentId] as DOMElementNode;
        parent.children.push(nodeId);
      } else if (childNode.nodeType === Node.ELEMENT_NODE) {
        const childElement = childNode as Element;
        const nodeId = uuidv4();

        // Create an element node
        const elementNode: DOMElementNode = {
          id: nodeId,
          type: 'element',
          tagName: childElement.tagName.toLowerCase(),
          attributes: {},
          children: [],
        };

        // Copy attributes
        for (const attr of Array.from(childElement.attributes)) {
          elementNode.attributes[attr.name] = attr.value;
        }

        // Store the mapping
        this.#domToNodeId.set(childElement, nodeId);
        this.#nodeIdToDom.set(nodeId, childElement);

        // Add to nodes map
        doc.nodes[nodeId] = elementNode;

        // Add to parent's children array
        const parent = doc.nodes[parentId] as DOMElementNode;
        parent.children.push(nodeId);

        // Recursively process this element's children
        this.#buildDOMTree(childElement, doc, nodeId);
      }
    }
  }

  // Get a node from the CRDT by ID
  #getNodeById(doc: SyncDoc, id: string): DOMNode | undefined {
    return doc.nodes[id];
  }

  // Get the node ID for a DOM node
  #getNodeIdForDomNode(node: Node): string | undefined {
    return this.#domToNodeId.get(node);
  }

  // Get the DOM node for a CRDT node ID
  #getDomNodeForNodeId(id: string): Node | undefined {
    return this.#nodeIdToDom.get(id);
  }

  // Ensure a node is tracked in the CRDT
  #ensureNodeTracked(node: Node): string | undefined {
    // Check if node is already tracked
    let nodeId = this.#getNodeIdForDomNode(node);
    if (nodeId !== undefined) {
      return nodeId;
    }

    // If the node is not tracked yet, we need to add it to the CRDT
    if (node.nodeType === Node.TEXT_NODE && node.parentNode) {
      const parentNode = node.parentNode;
      const parentId = this.#getNodeIdForDomNode(parentNode);

      if (parentId !== undefined) {
        // Create a new text node
        const newId = uuidv4();

        // Store the mapping
        this.#domToNodeId.set(node, newId);
        this.#nodeIdToDom.set(newId, node);

        // Add the node to the CRDT
        this.#doc = Automerge.change(this.#doc, (doc) => {
          try {
            const parentNode = doc.nodes[parentId] as DOMElementNode;
            if (parentNode.type !== 'element') {
              throw new Error('Expected element node');
            }

            // Create text node
            const textNode: DOMTextNode = {
              id: newId,
              type: 'text',
              textContent: node.textContent || '',
            };

            // Add to nodes map
            doc.nodes[newId] = textNode;

            // Find position in parent's DOM children
            // Get the actual parent DOM element
            const parentElement = this.#nodeIdToDom.get(parentId) as Element;
            if (!parentElement) {
              // Parent element not found in DOM, just add to the end
              parentNode.children.push(newId);
              return;
            }

            // Find position in DOM children
            const domChildren = Array.from(parentElement.childNodes);
            let position = -1;
            for (let i = 0; i < domChildren.length; i++) {
              if (domChildren[i] === node) {
                position = i;
                break;
              }
            }

            if (position >= 0) {
              // Now we need to convert this DOM position to CRDT position
              // by counting only significant nodes before this position
              let crdtPosition = 0;
              for (let i = 0; i < position; i++) {
                if (this.#isSignificantNode(domChildren[i])) {
                  crdtPosition++;
                }
              }

              // Insert at the appropriate position in the CRDT
              if (crdtPosition < parentNode.children.length) {
                parentNode.children.splice(crdtPosition, 0, newId);
              } else {
                parentNode.children.push(newId);
              }
            } else {
              // Otherwise just add to the end
              parentNode.children.push(newId);
            }
          } catch (e) {
            console.error('Error adding new text node to CRDT:', e);
          }
        });

        return newId;
      }
    } else if (node.nodeType === Node.ELEMENT_NODE && node.parentNode) {
      const parentNode = node.parentNode;
      const parentId = this.#getNodeIdForDomNode(parentNode);

      if (parentId !== undefined) {
        const element = node as Element;
        const newId = uuidv4();

        // Store the mapping
        this.#domToNodeId.set(node, newId);
        this.#nodeIdToDom.set(newId, node);

        // Add the node to the CRDT
        this.#doc = Automerge.change(this.#doc, (doc) => {
          try {
            const parentNode = doc.nodes[parentId] as DOMElementNode;
            if (parentNode.type !== 'element') {
              throw new Error('Expected element node');
            }

            // Create element node
            const elementNode: DOMElementNode = {
              id: newId,
              type: 'element',
              tagName: element.tagName.toLowerCase(),
              attributes: {},
              children: [],
            };

            // Copy attributes
            for (const attr of Array.from(element.attributes)) {
              elementNode.attributes[attr.name] = attr.value;
            }

            // Add to nodes map
            doc.nodes[newId] = elementNode;

            // Find position in parent's DOM children
            // Get the actual parent DOM element
            const parentElement = this.#nodeIdToDom.get(parentId) as Element;
            if (!parentElement) {
              // Parent element not found in DOM, just add to the end
              parentNode.children.push(newId);
              return;
            }

            // Find position in DOM children
            const domChildren = Array.from(parentElement.childNodes);
            let position = -1;
            for (let i = 0; i < domChildren.length; i++) {
              if (domChildren[i] === node) {
                position = i;
                break;
              }
            }

            if (position >= 0) {
              // Now we need to convert this DOM position to CRDT position
              // by counting only significant nodes before this position
              let crdtPosition = 0;
              for (let i = 0; i < position; i++) {
                if (this.#isSignificantNode(domChildren[i])) {
                  crdtPosition++;
                }
              }

              // Insert at the appropriate position in the CRDT
              if (crdtPosition < parentNode.children.length) {
                parentNode.children.splice(crdtPosition, 0, newId);
              } else {
                parentNode.children.push(newId);
              }
            } else {
              // Otherwise just add to the end
              parentNode.children.push(newId);
            }

            // Recursively add children
            this.#buildDOMTree(element, doc, newId);
          } catch (e) {
            console.error('Error adding new element node to CRDT:', e);
          }
        });

        return newId;
      }
    }

    return undefined;
  }

  // Simplified logging of a DOM node and its CRDT counterpart
  #logNodeComparison(node: Node, description: string) {
    // Make sure the node is tracked before logging
    let nodeId = this.#ensureNodeTracked(node);

    if (nodeId === undefined) {
      console.log(`${description} - Failed to track node:`, node);
      return;
    }

    try {
      const crdtNode = this.#getNodeById(this.#doc, nodeId);
      console.log(`${description} - Node ID: ${nodeId}`);

      if (node.nodeType === Node.TEXT_NODE) {
        console.log('  DOM TEXT NODE:', {
          textContent: node.textContent,
        });
        console.log('  CRDT:', crdtNode);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as Element;
        // Count only significant nodes in DOM for fair comparison
        const significantChildrenCount = Array.from(element.childNodes).filter((child) =>
          this.#isSignificantNode(child),
        ).length;

        console.log('  DOM ELEMENT:', {
          tagName: element.tagName.toLowerCase(),
          attributes: Array.from(element.attributes).reduce(
            (obj, attr) => {
              obj[attr.name] = attr.value;
              return obj;
            },
            {} as Record<string, string>,
          ),
          totalChildrenCount: element.childNodes.length,
          significantChildrenCount,
        });

        if (crdtNode?.type === 'element') {
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
      console.log(`${description} - Could not find CRDT node for ID ${nodeId}:`, e);
    }
  }

  // Handle DOM mutations and update the CRDT
  #handleMutations(mutations: MutationRecord[]) {
    if (mutations.length === 0) return;

    console.log(`==== Handling ${mutations.length} mutations ====`);
    const affectedNodes = new Set<Node>();

    // Group mutations by type for more efficient processing
    const childListMutations: MutationRecord[] = [];
    const attributeMutations: MutationRecord[] = [];
    const characterDataMutations: MutationRecord[] = [];

    // Process each mutation
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        childListMutations.push(mutation);
        affectedNodes.add(mutation.target);

        // Track all added and removed nodes
        for (const node of Array.from(mutation.addedNodes)) {
          if (this.#isSignificantNode(node)) {
            affectedNodes.add(node);
          }
        }
        for (const node of Array.from(mutation.removedNodes)) {
          if (this.#isSignificantNode(node)) {
            affectedNodes.add(node);
          }
        }
      } else if (mutation.type === 'attributes') {
        attributeMutations.push(mutation);
        affectedNodes.add(mutation.target);
      } else if (mutation.type === 'characterData') {
        characterDataMutations.push(mutation);
        affectedNodes.add(mutation.target);
      }
    }

    // Process mutations in the optimal order:
    // 1. First attribute changes (least structural impact)
    // 2. Then text content changes (medium impact)
    // 3. Finally childList changes (greatest structural impact)

    console.log(`Processing ${attributeMutations.length} attribute mutations`);
    for (const mutation of attributeMutations) {
      this.#processAttributeMutation(mutation);
    }

    console.log(`Processing ${characterDataMutations.length} text content mutations`);
    for (const mutation of characterDataMutations) {
      this.#processCharacterDataMutation(mutation);
    }

    console.log(`Processing ${childListMutations.length} child list mutations`);
    for (const mutation of childListMutations) {
      this.#processChildListMutation(mutation);
    }

    // Log the affected nodes
    console.log(`--- Synced ${affectedNodes.size} nodes ---`);

    // Only log detailed node info if there aren't too many affected nodes
    if (affectedNodes.size <= 5) {
      affectedNodes.forEach((node) => {
        this.#logNodeComparison(node, 'Affected node');
      });
    } else {
      console.log(`Too many affected nodes to log individually (${affectedNodes.size})`);
    }

    console.log(`==== Mutations processing complete ====`);
  }

  // Check if a node is significant (not empty text, comment, etc.)
  #isSignificantNode(node: Node): boolean {
    if (node.nodeType === Node.TEXT_NODE) {
      // Only track non-empty text nodes (ignoring whitespace)
      const text = node.textContent || '';
      return text.trim() !== '';
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      // Always track element nodes
      return true;
    }
    // Ignore comment nodes, processing instructions, etc.
    return false;
  }

  // Process a childList mutation (nodes added or removed)
  #processChildListMutation(mutation: MutationRecord) {
    // Get the parent element
    const parentElement = mutation.target as Element;
    if (!parentElement || parentElement.nodeType !== Node.ELEMENT_NODE) return;

    // Get the parent node ID
    const parentId = this.#getNodeIdForDomNode(parentElement);
    if (parentId === undefined) {
      console.warn('Parent element not tracked in CRDT:', parentElement);
      return;
    }

    // Log mutation details for debugging
    console.log('Processing childList mutation:', {
      parent: parentElement.tagName,
      addedCount: mutation.addedNodes.length,
      removedCount: mutation.removedNodes.length,
    });

    // Handle removed nodes first - we need to remove them from the CRDT
    for (const removedNode of Array.from(mutation.removedNodes)) {
      if (this.#isSignificantNode(removedNode)) {
        const removedNodeId = this.#getNodeIdForDomNode(removedNode);
        if (removedNodeId) {
          console.log('Removing node:', {
            nodeType: removedNode.nodeType === Node.TEXT_NODE ? 'text' : 'element',
            id: removedNodeId,
            content:
              removedNode.nodeType === Node.TEXT_NODE ? removedNode.textContent : (removedNode as Element).tagName,
          });

          this.#doc = Automerge.change(this.#doc, (doc) => {
            try {
              const parentNode = doc.nodes[parentId] as DOMElementNode;
              if (parentNode.type !== 'element') {
                throw new Error('Expected element node');
              }

              // Remove from parent's children array
              const index = parentNode.children.indexOf(removedNodeId);
              if (index !== -1) {
                parentNode.children.splice(index, 1);
              } else {
                console.warn('Node ID not found in parent children array:', removedNodeId);
              }

              // Note: We don't delete from nodes map to support undo/redo
              // The node remains in the CRDT but is no longer referenced
            } catch (e) {
              console.error('Error removing node from CRDT:', e);
            }
          });
        } else {
          console.warn('Removed node not tracked in CRDT:', removedNode);
        }
      }
    }

    // Handle added nodes - we need to add them to the CRDT
    for (const addedNode of Array.from(mutation.addedNodes)) {
      if (this.#isSignificantNode(addedNode)) {
        // Track the node if it's not already tracked
        const existingNodeId = this.#getNodeIdForDomNode(addedNode);
        if (!existingNodeId) {
          if (addedNode.nodeType === Node.TEXT_NODE) {
            // Ensure text node is tracked
            const newId = this.#ensureNodeTracked(addedNode);
            console.log('Added text node:', { id: newId, content: addedNode.textContent });
          } else if (addedNode.nodeType === Node.ELEMENT_NODE) {
            // Ensure element node is tracked - this will also track all its children
            const newId = this.#ensureNodeTracked(addedNode);
            console.log('Added element node:', { id: newId, tagName: (addedNode as Element).tagName });
          }
        } else {
          console.log('Added node already tracked:', { id: existingNodeId });
          // If the node was just moved within the DOM, we need to update its position
          this.#updateNodePosition(addedNode, existingNodeId, parentElement, parentId);
        }
      }
    }

    // Validate the children order in the CRDT against the DOM
    this.#validateChildrenOrder(parentElement, parentId);
  }

  // Helper method to update a node's position within its parent
  #updateNodePosition(node: Node, nodeId: string, parentElement: Element, parentId: string) {
    this.#doc = Automerge.change(this.#doc, (doc) => {
      try {
        const parentNode = doc.nodes[parentId] as DOMElementNode;
        if (parentNode.type !== 'element') {
          throw new Error('Expected element node');
        }

        // First remove the node from its current position
        const currentIndex = parentNode.children.indexOf(nodeId);
        if (currentIndex !== -1) {
          parentNode.children.splice(currentIndex, 1);
        }

        // Find the DOM position
        const domChildren = Array.from(parentElement.childNodes);
        let domPosition = -1;
        for (let i = 0; i < domChildren.length; i++) {
          if (domChildren[i] === node) {
            domPosition = i;
            break;
          }
        }

        if (domPosition === -1) {
          console.warn('Node not found in parent DOM children:', node);
          return;
        }

        // Convert to CRDT position (count only significant nodes)
        let crdtPosition = 0;
        for (let i = 0; i < domPosition; i++) {
          if (this.#isSignificantNode(domChildren[i])) {
            crdtPosition++;
          }
        }

        // Insert at the new position
        if (crdtPosition < parentNode.children.length) {
          parentNode.children.splice(crdtPosition, 0, nodeId);
        } else {
          parentNode.children.push(nodeId);
        }
      } catch (e) {
        console.error('Error updating node position in CRDT:', e);
      }
    });
  }

  // Validate and update children order if necessary
  #validateChildrenOrder(parentElement: Element, parentId: string) {
    this.#doc = Automerge.change(this.#doc, (doc) => {
      try {
        const parentNode = doc.nodes[parentId] as DOMElementNode;
        if (parentNode.type !== 'element') {
          throw new Error('Expected element node');
        }

        // Get all significant DOM children
        const significantDomChildren = Array.from(parentElement.childNodes).filter((node) =>
          this.#isSignificantNode(node),
        );

        // Get current CRDT children IDs
        const crdtChildrenIds = [...parentNode.children];

        // Create a new ordered array of child IDs based on DOM order
        const newChildrenOrder: string[] = [];

        for (const domChild of significantDomChildren) {
          const childId = this.#getNodeIdForDomNode(domChild);
          if (childId) {
            newChildrenOrder.push(childId);
          } else {
            // If we found a DOM node that's not tracked in the CRDT, track it now
            const newChildId = this.#ensureNodeTracked(domChild);
            if (newChildId) {
              newChildrenOrder.push(newChildId);
            }
          }
        }

        // Double check that all new IDs exist in the CRDT nodes map
        // This helps debug any potential issues with node tracking
        for (const id of newChildrenOrder) {
          if (!doc.nodes[id]) {
            console.error(`Validation error: Child ID ${id} exists in order array but not in nodes map`);
          }
        }

        // Only update if the order is different
        if (JSON.stringify(newChildrenOrder) !== JSON.stringify(crdtChildrenIds)) {
          console.log(`Updating children order for ${parentElement.tagName}:`, {
            oldOrder: crdtChildrenIds,
            newOrder: newChildrenOrder,
          });

          // Replace the children array with the correctly ordered one
          parentNode.children.splice(0, parentNode.children.length, ...newChildrenOrder);
        }
      } catch (e) {
        console.error('Error validating children order:', e);
      }
    });
  }

  // Process an attribute mutation
  #processAttributeMutation(mutation: MutationRecord) {
    const element = mutation.target as Element;
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return;

    // Skip the folk-sync attribute itself to avoid circular updates
    if (mutation.attributeName === FolkSyncAttribute.attributeName) {
      return;
    }

    const nodeId = this.#getNodeIdForDomNode(element);
    if (nodeId === undefined) {
      console.warn('Element not tracked in CRDT:', element);
      return;
    }

    this.#doc = Automerge.change(this.#doc, (doc) => {
      try {
        const crdtNode = doc.nodes[nodeId] as DOMElementNode;
        if (crdtNode.type !== 'element') {
          throw new Error('Expected element node');
        }

        const attrName = mutation.attributeName!;
        const newValue = element.getAttribute(attrName);
        const oldValue = mutation.oldValue;

        console.log('Attribute changed:', {
          element: element.tagName,
          attribute: attrName,
          oldValue,
          newValue,
        });

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

    // Check if this is a significant text node (non-empty)
    if (!this.#isSignificantNode(textNode)) {
      // If it's not significant now but was tracked before, we might need to remove it
      const nodeId = this.#getNodeIdForDomNode(textNode);
      if (nodeId) {
        console.log('Text node became empty, checking if it should be removed:', nodeId);

        // If the parent is tracked, we can handle removing this node
        const parentNode = textNode.parentNode;
        if (parentNode) {
          const parentId = this.#getNodeIdForDomNode(parentNode);
          if (parentId) {
            this.#doc = Automerge.change(this.#doc, (doc) => {
              try {
                const parentCrdtNode = doc.nodes[parentId] as DOMElementNode;
                if (parentCrdtNode.type !== 'element') {
                  throw new Error('Expected element node');
                }

                // Remove from parent's children
                const index = parentCrdtNode.children.indexOf(nodeId);
                if (index !== -1) {
                  parentCrdtNode.children.splice(index, 1);
                  console.log('Removed empty text node from CRDT');
                }

                // Keep the node in the map to support undo/redo
              } catch (e) {
                console.error('Error removing empty text node:', e);
              }
            });
          }
        }
      }
      return;
    }

    let nodeId = this.#getNodeIdForDomNode(textNode);

    // If the text node isn't tracked yet, try to track it
    if (nodeId === undefined) {
      nodeId = this.#ensureNodeTracked(textNode);
      if (nodeId === undefined) {
        console.error('Unable to track text node:', textNode);
        return;
      }
    }

    // Log the content change
    console.log('Text content changed:', {
      id: nodeId,
      oldContent: mutation.oldValue,
      newContent: textNode.textContent,
    });

    // Update the text content
    this.#doc = Automerge.change(this.#doc, (doc) => {
      try {
        const crdtNode = doc.nodes[nodeId!] as DOMTextNode;
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
    console.log('FolkSync connected to', this.ownerElement);

    // Initialize the CRDT document
    this.#initializeDoc();

    // Start observing mutations
    this.#startObserving();
  }

  disconnectedCallback(): void {
    console.log('FolkSync disconnected from', this.ownerElement);

    // Stop observing mutations
    this.#stopObserving();
  }
}
