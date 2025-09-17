import {
  DocHandle,
  generateAutomergeUrl,
  getObjectId,
  ImmutableString,
  isValidAutomergeUrl,
  Repo,
  WebSocketClientAdapter,
  type Doc,
  type ObjID,
  type Patch,
  type PeerId,
  type Prop,
} from '@folkjs/collab/automerge';
import { CustomAttribute } from '@folkjs/dom/CustomAttribute';
import type { DOMJElement, DOMJNode } from '@folkjs/labs/dom-json';

/**
 * Helper to get object ID from a path in an Automerge document
 */
function getIdFromPath<T>(obj: Doc<T>, path: Prop[]): ObjID | null {
  return getObjectId(path.reduce((current: any, key) => current?.[key], obj));
}

/**
 * Get the path to the DOM node object (up to "childNodes" and its index)
 * Example: ["childNodes", 1, "attributes", "style", 5] -> ["childNodes", 1]
 */
function getNodePath(path: Prop[]): Prop[] {
  // Find the last occurrence of "childNodes"
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i] === 'childNodes' && i + 1 < path.length && typeof path[i + 1] === 'number') {
      return path.slice(0, i + 2); // Include "childNodes" and the index
    }
  }
  // If no "childNodes" found, return empty path (root node)
  return [];
}

export class FolkSyncAttribute extends CustomAttribute {
  static override attributeName = 'folk-sync';

  // Automerge repository and document handle
  #repo!: Repo;
  #handle!: DocHandle<DOMJElement>;
  #networkAdapter!: WebSocketClientAdapter;
  #isLocalChange: boolean = false;

  // MutationObserver instance
  #observer: MutationObserver | null = null;

  // Sync mappings - DOM node to Automerge symbol ID and vice versa
  #domToAutomergeId = new Map<Node, ObjID>();
  #automergeIdToDom = new Map<ObjID, Node>();

  // Flag to prevent recursive updates
  #isApplyingRemoteChanges = false;

  // Hash change listener
  #hashChangeListener?: () => void;

  /**
   * Helper to store DOM-Automerge mapping
   */
  #storeMapping(domNode: Node, automergeNode: DOMJNode): void {
    const id = getObjectId(automergeNode);
    if (id) {
      this.#domToAutomergeId.set(domNode, id);
      this.#automergeIdToDom.set(id, domNode);
    } else {
      console.error(`No ID found for automerge object:`, automergeNode);
    }
  }

  /**
   * Helper to synchronize attributes from Automerge to DOM element
   */
  #setDOMAttributes(domElement: Element, automergeAttributes: Record<string, ImmutableString>): void {
    // Set/update attributes from Automerge
    for (const [name, attrValue] of Object.entries(automergeAttributes)) {
      // All attributes are ImmutableString - extract the string value
      const value = attrValue.val;
      const currentValue = domElement.getAttribute(name);

      if (currentValue !== value) {
        domElement.setAttribute(name, value);
      }
    }
  }

  /**
   * Helper to synchronize text content from Automerge to DOM node
   */
  #setDOMText(domNode: Node, textContent: string): void {
    if (domNode.textContent !== textContent) {
      domNode.textContent = textContent;
    }
  }

  /**
   * Find an Automerge node by its object ID by traversing the document
   * NOTE: The hope is that this will become redundant with new automerge APIs to do direct mutations by id
   */
  #findAutomergeNodeById(rootNode: DOMJElement, targetId: string): DOMJNode | null {
    // Check if this node matches
    const nodeId = getObjectId(rootNode);
    if (nodeId === targetId) {
      return rootNode;
    }

    // Recursively search children
    for (const child of rootNode.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const found = this.#findAutomergeNodeById(child, targetId);
        if (found) return found;
      } else {
        // Check text/comment nodes
        const childId = getObjectId(child);
        if (childId === targetId) {
          return child;
        }
      }
    }

    return null;
  }

  /**
   * Build Automerge document structure from DOM tree
   */
  #buildAutomergeFromDOM(element: Element): DOMJElement {
    const attributes: { [key: string]: ImmutableString } = {};
    for (const attr of element.attributes) {
      // Use ImmutableString to prevent text merging conflicts
      attributes[attr.name] = new ImmutableString(attr.value);
    }

    const childNodes: DOMJNode[] = [];
    for (const child of element.childNodes) {
      switch (child.nodeType) {
        case Node.ELEMENT_NODE: {
          childNodes.push(this.#buildAutomergeFromDOM(child as Element));
          break;
        }
        case Node.TEXT_NODE: {
          childNodes.push({
            nodeType: Node.TEXT_NODE,
            textContent: child.textContent || '',
          });
          break;
        }
        case Node.COMMENT_NODE: {
          childNodes.push({
            nodeType: Node.COMMENT_NODE,
            textContent: child.textContent || '',
          });
          break;
        }
      }
    }

    return {
      nodeType: Node.ELEMENT_NODE,
      tagName: element.tagName.toLowerCase(),
      attributes,
      childNodes,
    };
  }

  /**
   * Build DOM children from Automerge document (skips root element)
   */
  #buildDOMFromAutomerge(automergeRootNode: DOMJElement, parentElement: Element): void {
    // For root node, don't create the element - just build its children into the parent
    for (const child of automergeRootNode.childNodes) {
      this.#buildDOMNode(child, parentElement);
    }
  }

  /**
   * Build a single DOM node from Automerge structure
   */
  #buildDOMNode(automergeNode: DOMJNode, parentElement: Element): void {
    const { nodeType } = automergeNode;
    switch (nodeType) {
      case Node.ELEMENT_NODE: {
        const element = document.createElement(automergeNode.tagName);

        // Set attributes using helper
        this.#setDOMAttributes(element, automergeNode.attributes);

        // Add to parent
        parentElement.appendChild(element);

        // Process children recursively
        for (const child of automergeNode.childNodes) {
          this.#buildDOMNode(child, element);
        }

        // Store mapping
        this.#storeMapping(element, automergeNode);
        break;
      }

      case Node.TEXT_NODE: {
        const textNode = document.createTextNode(automergeNode.textContent);
        parentElement.appendChild(textNode);
        this.#storeMapping(textNode, automergeNode);
        break;
      }

      case Node.COMMENT_NODE: {
        const commentNode = document.createComment(automergeNode.textContent);
        parentElement.appendChild(commentNode);
        this.#storeMapping(commentNode, automergeNode);
        break;
      }

      default: {
        nodeType satisfies never;
        throw new Error(`Unhandled node type: ${nodeType}`);
      }
    }
  }

  /**
   * Handle DOM mutations - convert to Automerge changes
   */
  #handleDOMMutation(mutation: MutationRecord): void {
    if (!this.#handle) {
      console.warn('Cannot handle DOM mutation: Document handle not initialized');
      return;
    }

    // Set flag to indicate this is a local change
    this.#isLocalChange = true;

    // Store information about added nodes to create mappings after the change
    let addedNodeInfo: Array<{ domNode: Node; parentElement: Element }> = [];

    this.#handle.change((doc) => {
      switch (mutation.type) {
        case 'attributes':
        case 'characterData': {
          // For attribute and character data changes, we need the target node to exist in mappings
          const targetId = this.#domToAutomergeId.get(mutation.target);
          if (!targetId) {
            console.warn('Cannot find Automerge ID for mutated DOM node:', mutation.target);
            return;
          }

          const targetNode = this.#findAutomergeNodeById(doc, targetId);
          if (!targetNode) {
            console.warn('Cannot find Automerge node with ID:', targetId);
            return;
          }

          if (mutation.type === 'attributes') {
            if (targetNode.nodeType === Node.ELEMENT_NODE && mutation.attributeName) {
              const element = mutation.target as Element;
              const newValue = element.getAttribute(mutation.attributeName);

              if (newValue === null) {
                // Attribute was removed
                delete targetNode.attributes[mutation.attributeName];
              } else {
                // Attribute was added or changed
                // Always create a new ImmutableString to ensure proper Automerge tracking
                targetNode.attributes[mutation.attributeName] = new ImmutableString(String(newValue));
              }
            }
          } else if (mutation.type === 'characterData') {
            if (targetNode.nodeType === Node.TEXT_NODE || targetNode.nodeType === Node.COMMENT_NODE) {
              targetNode.textContent = mutation.target.textContent || '';
            }
          }
          break;
        }
        case 'childList': {
          // For childList mutations, the target is the parent container
          const parentId = this.#domToAutomergeId.get(mutation.target);
          if (!parentId) {
            console.warn('Cannot find Automerge ID for parent of childList mutation:', mutation.target);
            return;
          }

          const parentNode = this.#findAutomergeNodeById(doc, parentId);
          if (!parentNode || parentNode.nodeType !== Node.ELEMENT_NODE) {
            console.warn('Cannot find parent Automerge element node with ID:', parentId);
            return;
          }

          const parentElement = mutation.target as Element;

          // Handle added nodes - add to Automerge but defer mapping creation
          if (mutation.addedNodes.length > 0) {
            this.#handleAddedNodesInTransaction(parentElement, mutation.addedNodes, parentNode);
            // Store info for post-transaction mapping
            for (const addedNode of mutation.addedNodes) {
              addedNodeInfo.push({ domNode: addedNode, parentElement });
            }
          }

          // Handle removed nodes
          if (mutation.removedNodes.length > 0) {
            this.#handleRemovedNodesInTransaction(mutation.removedNodes, parentNode);
          }
          break;
        }
        default: {
          mutation.type satisfies never;
          throw new Error(`Unhandled mutation type: ${mutation.type}`);
        }
      }
    });

    // After the change is committed, create mappings for added nodes
    if (addedNodeInfo.length > 0) {
      this.#createMappingsForAddedNodes(addedNodeInfo);
    }

    // Reset the flag
    this.#isLocalChange = false;
  }

  /**
   * Handle Automerge patches - convert to DOM changes
   */
  async #handleAutomergePatches(patches: Patch[]): Promise<void> {
    // Set flag to prevent recursive updates
    this.#isApplyingRemoteChanges = true;

    try {
      const doc = this.#handle.doc();
      if (!doc) {
        console.warn('No document available for handling patches');
        return;
      }

      for (const patch of patches) {
        switch (patch.action) {
          case 'insert': {
            await this.#handleInsertPatch(patch, doc);
            break;
          }
          case 'del': {
            await this.#handleDeletePatch(patch, doc);
            break;
          }
          default: {
            // Handle property updates (like attributes, textContent)
            await this.#handlePropertyUpdatePatch(patch, doc);
            break;
          }
        }
      }
    } finally {
      // Always reset the flag
      this.#isApplyingRemoteChanges = false;
    }
  }

  /**
   * Update a DOM node to match the current state of its corresponding Automerge node
   * Only updates the node itself, not its children
   */
  #updateDOMNodeFromAutomerge(domNode: Node, automergeNode: DOMJNode): void {
    switch (automergeNode.nodeType) {
      case Node.ELEMENT_NODE: {
        if (domNode.nodeType !== Node.ELEMENT_NODE) {
          return;
        }

        const domElement = domNode as Element;

        // Update attributes to match Automerge state
        // First, remove any attributes that don't exist in Automerge
        const existingAttributes = Array.from(domElement.attributes);
        for (const attr of existingAttributes) {
          if (!(attr.name in automergeNode.attributes)) {
            domElement.removeAttribute(attr.name);
          }
        }

        // Then, set/update attributes from Automerge using helper
        this.#setDOMAttributes(domElement, automergeNode.attributes);
        break;
      }

      case Node.TEXT_NODE: {
        if (domNode.nodeType !== Node.TEXT_NODE) {
          return;
        }

        this.#setDOMText(domNode, automergeNode.textContent);
        break;
      }

      case Node.COMMENT_NODE: {
        if (domNode.nodeType !== Node.COMMENT_NODE) {
          return;
        }

        this.#setDOMText(domNode, automergeNode.textContent);
        break;
      }
    }
  }

  /**
   * Start observing DOM mutations
   */
  #startObserving(): void {
    if (!this.#observer) {
      this.#observer = new MutationObserver((mutations) => {
        if (this.#isApplyingRemoteChanges) return;

        if (!this.#handle) {
          throw new Error('Cannot handle mutations: Document handle not initialized');
        }

        // Process each mutation
        for (const mutation of mutations) {
          this.#handleDOMMutation(mutation);
        }
      });
    }

    this.#observer.observe(this.ownerElement, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
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
   * Create a new document from the current DOM state and initialize it
   */
  #createNewDocument(): void {
    const initialDoc = this.#buildAutomergeFromDOM(this.ownerElement);
    this.#handle = this.#repo.create<DOMJElement>(initialDoc as any);

    this.#handle
      .whenReady()
      .then(async () => {
        // Update the URL hash only if not using attribute value
        if (!this.value) {
          window.location.hash = this.#handle.url;
        }

        // Initialize as a new document
        const doc = this.#handle.doc();
        if (doc) {
          this.#initializeWithDocument(doc, true);
        }
      })
      .catch((error: any) => {
        console.error('FolkSync initialization promise rejected:', error);
        throw error;
      });
  }

  /**
   * Initialize when the attribute is connected to the DOM
   */
  override connectedCallback(): void {
    // Initialize Automerge repository
    this.#initializeRepo();

    // Initialize document based on current hash
    this.#initializeDocument();

    // Set up hash change listener only if not using attribute value
    if (!this.value) {
      this.#hashChangeListener = () => {
        this.#reinitialize();
      };
      window.addEventListener('hashchange', this.#hashChangeListener);
    }

    // DEBUG: just here for testing atm
    (window as any).aid = generateAutomergeUrl;
  }

  /**
   * Initialize the Automerge repository
   */
  #initializeRepo(): void {
    const peerId = `peer-${Math.floor(Math.random() * 1_000_000)}` as PeerId;

    // Set up the WebSocket network adapter
    this.#networkAdapter = new WebSocketClientAdapter('wss://sync.automerge.org');

    // Initialize the repo with network configuration
    this.#repo = new Repo({
      peerId,
      network: [this.#networkAdapter],
      // TODO: local storage
    });
  }

  /**
   * Initialize document based on attribute value or current URL hash
   */
  async #initializeDocument(): Promise<void> {
    // Use attribute value if provided, otherwise fall back to URL hash
    const docId = this.value || window.location.hash.slice(1);

    // If no valid document ID, create new document
    if (!docId || !isValidAutomergeUrl(docId)) {
      this.#createNewDocument();
      return;
    }

    // Try to connect to existing document
    this.#handle = await this.#repo.find<DOMJElement>(docId);

    try {
      const doc = this.#handle.doc();
      if (doc) {
        this.#initializeWithDocument(doc, false);
      } else {
        this.#createNewDocument();
      }
    } catch (error) {
      console.error('Error finding document:', error);
      this.#createNewDocument();
    }
  }

  /**
   * Reinitialize when hash changes
   */
  #reinitialize(): void {
    // Stop current sync
    this.#stopObserving();

    // Clear mappings
    this.#domToAutomergeId = new Map<Node, string>();
    this.#automergeIdToDom = new Map<string, Node>();

    // Initialize with new hash
    this.#initializeDocument();
  }

  /**
   * Create mappings for existing DOM tree when initializing a new document
   */
  #createMappingsForExistingDOM(automergeRootNode: DOMJElement): void {
    // Map all existing children in the DOM to their corresponding Automerge nodes
    const domChildren = Array.from(this.ownerElement.childNodes);
    const automergeChildren = automergeRootNode.childNodes;

    for (let i = 0; i < domChildren.length && i < automergeChildren.length; i++) {
      this.#createMappingsForSubtree(domChildren[i], automergeChildren[i]);
    }
  }

  /**
   * Initialize the sync system once we have a document
   */
  async #initializeWithDocument(doc: DOMJElement, isNewDocument: boolean): Promise<void> {
    if (!isNewDocument) {
      // Clear DOM and rebuild from Automerge
      this.ownerElement.replaceChildren();
      this.#buildDOMFromAutomerge(doc, this.ownerElement);
    } else {
      // For new documents, create mappings for existing DOM tree
      this.#createMappingsForExistingDOM(doc);
    }

    // Always create mapping for the root element (ownerElement -> Automerge doc root)
    this.#storeMapping(this.ownerElement, doc);

    // Set up change handler
    this.#handle.on('change', ({ doc: updatedDoc, patches }) => {
      if (updatedDoc && !this.#isLocalChange) {
        this.#handleAutomergePatches(patches || []);
      }
    });

    this.#startObserving();
  }

  /**
   * Clean up when the attribute is disconnected from the DOM
   */
  override disconnectedCallback(): void {
    this.#stopObserving();

    // Remove hash change listener
    if (this.#hashChangeListener) {
      window.removeEventListener('hashchange', this.#hashChangeListener);
      this.#hashChangeListener = undefined;
    }
  }

  /**
   * Convert a DOM node (and its subtree) to Automerge format
   */
  #convertDOMNodeToAutomerge(domNode: Node): DOMJNode {
    switch (domNode.nodeType) {
      case Node.ELEMENT_NODE: {
        const element = domNode as Element;
        return this.#buildAutomergeFromDOM(element);
      }
      case Node.TEXT_NODE: {
        return {
          nodeType: Node.TEXT_NODE,
          textContent: domNode.textContent || '',
        };
      }
      case Node.COMMENT_NODE: {
        return {
          nodeType: Node.COMMENT_NODE,
          textContent: domNode.textContent || '',
        };
      }
      default: {
        throw new Error(`Unsupported node type for conversion: ${domNode.nodeType}`);
      }
    }
  }

  /**
   * Create mappings for a DOM node and its Automerge counterpart (including all descendants)
   */
  #createMappingsForSubtree(domNode: Node, automergeNode: DOMJNode): void {
    // Create mapping for this node
    this.#storeMapping(domNode, automergeNode);

    // Recursively create mappings for children
    if (domNode.nodeType === Node.ELEMENT_NODE && automergeNode.nodeType === Node.ELEMENT_NODE) {
      const domElement = domNode as Element;
      const domChildren = Array.from(domElement.childNodes);
      const automergeChildren = automergeNode.childNodes;

      for (let i = 0; i < domChildren.length && i < automergeChildren.length; i++) {
        this.#createMappingsForSubtree(domChildren[i], automergeChildren[i]);
      }
    }
  }

  /**
   * Find the insertion position in Automerge childNodes array based on DOM position
   */
  #findInsertionPosition(parentElement: Element, insertedNode: ChildNode): number {
    const domChildren = Array.from(parentElement.childNodes);
    const insertedIndex = domChildren.indexOf(insertedNode);

    if (insertedIndex === -1) {
      throw new Error('Inserted node not found in parent children');
    }

    // Count how many preceding siblings are tracked in Automerge
    let automergePosition = 0;
    for (let i = 0; i < insertedIndex; i++) {
      const siblingId = this.#domToAutomergeId.get(domChildren[i]);
      if (siblingId) {
        automergePosition++;
      }
    }

    return automergePosition;
  }

  /**
   * Handle added nodes in transaction (without creating mappings)
   */
  #handleAddedNodesInTransaction(parentElement: Element, addedNodes: NodeList, parentAutomergeNode: DOMJElement): void {
    for (const addedNode of addedNodes) {
      // Convert DOM node to Automerge format
      const automergeNode = this.#convertDOMNodeToAutomerge(addedNode);

      // Find insertion position (addedNode should be a ChildNode since it's being added to an element)
      const insertionPosition = this.#findInsertionPosition(parentElement, addedNode as ChildNode);

      // Insert into Automerge document
      parentAutomergeNode.childNodes.splice(insertionPosition, 0, automergeNode);

      // Note: Mappings will be created after the transaction completes
    }
  }

  /**
   * Create mappings for added nodes after transaction completion
   */
  #createMappingsForAddedNodes(addedNodeInfo: Array<{ domNode: Node; parentElement: Element }>): void {
    const doc = this.#handle.doc();
    if (!doc) {
      console.warn('Cannot create mappings: No document available');
      return;
    }

    for (const { domNode, parentElement } of addedNodeInfo) {
      // Find the parent in Automerge document
      const parentId = this.#domToAutomergeId.get(parentElement);
      if (!parentId) {
        console.warn('Cannot find parent ID for mapping creation');
        continue;
      }

      const parentAutomergeNode = this.#findAutomergeNodeById(doc, parentId);
      if (!parentAutomergeNode || parentAutomergeNode.nodeType !== Node.ELEMENT_NODE) {
        console.warn('Cannot find parent Automerge node for mapping creation');
        continue;
      }

      // Find the corresponding Automerge node by position
      const insertionPosition = this.#findInsertionPosition(parentElement, domNode as ChildNode);
      const automergeNode = parentAutomergeNode.childNodes[insertionPosition];

      if (automergeNode) {
        this.#createMappingsForSubtree(domNode, automergeNode);
      } else {
        console.warn('Cannot find corresponding Automerge node for mapping');
      }
    }
  }

  /**
   * Handle insertion patches from Automerge
   */
  async #handleInsertPatch(patch: Patch, doc: DOMJElement): Promise<void> {
    // Insert patches are for childNodes arrays - check if this is a childNodes insertion
    if (!patch.path.includes('childNodes')) {
      console.warn('Insert patch not in childNodes, skipping:', patch);
      return;
    }

    // Get the parent node path (up to "childNodes")
    const parentPath = patch.path.slice(0, patch.path.lastIndexOf('childNodes') + 1);
    const insertionIndex = patch.path[patch.path.length - 1];

    if (typeof insertionIndex !== 'number') {
      console.warn('Insert patch index is not a number:', insertionIndex);
      return;
    }

    // Get the parent object ID
    const parentObjectId = getIdFromPath(doc, parentPath.slice(0, -1)); // Remove 'childNodes'
    if (!parentObjectId) {
      console.warn('Cannot find parent object ID for insert patch:', patch);
      return;
    }

    // Find the corresponding DOM parent node
    const parentDomNode = this.#automergeIdToDom.get(parentObjectId);
    if (!parentDomNode || parentDomNode.nodeType !== Node.ELEMENT_NODE) {
      console.warn('Cannot find parent DOM element for insert patch:', patch);
      return;
    }

    const parentElement = parentDomNode as Element;

    // Get the inserted Automerge node(s) from the current document
    const parentAutomergeNode = this.#findAutomergeNodeById(doc, parentObjectId);
    if (!parentAutomergeNode || parentAutomergeNode.nodeType !== Node.ELEMENT_NODE) {
      console.warn('Cannot find parent Automerge node for insert patch:', patch);
      return;
    }

    // Handle potentially multiple consecutive insertions starting at this index
    // Count how many new nodes don't have DOM mappings yet
    let insertedCount = 0;
    for (let i = insertionIndex; i < parentAutomergeNode.childNodes.length; i++) {
      const automergeChild = parentAutomergeNode.childNodes[i];
      const childId = getObjectId(automergeChild);
      if (childId && this.#automergeIdToDom.has(childId)) {
        // This node already has a mapping, stop counting
        break;
      }
      insertedCount++;
    }

    // Insert all the new consecutive elements
    for (let i = 0; i < insertedCount; i++) {
      const currentIndex = insertionIndex + i;
      const insertedAutomergeNode = parentAutomergeNode.childNodes[currentIndex];

      if (!insertedAutomergeNode) {
        console.warn('Cannot find inserted Automerge node at index:', currentIndex);
        continue;
      }

      // Create the corresponding DOM node
      const insertedDomNode = this.#createDOMNodeFromAutomerge(insertedAutomergeNode);

      // Find the correct insertion position in DOM (considering existing mappings)
      const domInsertionIndex = this.#findDOMInsertionIndex(currentIndex, parentAutomergeNode.childNodes);

      // Insert the DOM node
      if (domInsertionIndex >= parentElement.childNodes.length) {
        parentElement.appendChild(insertedDomNode);
      } else {
        const referenceNode = parentElement.childNodes[domInsertionIndex];
        parentElement.insertBefore(insertedDomNode, referenceNode);
      }

      // Create mappings for the inserted subtree
      this.#createMappingsForSubtree(insertedDomNode, insertedAutomergeNode);
    }
  }

  /**
   * Handle property update patches from Automerge
   */
  async #handlePropertyUpdatePatch(patch: Patch, doc: DOMJElement): Promise<void> {
    // Get the node path (up to "childNodes" and its index)
    const nodePath = getNodePath(patch.path);

    // Get the object ID of the changed node
    const nodeObjectId = getIdFromPath(doc, nodePath);
    if (!nodeObjectId) {
      return;
    }

    // Find the corresponding DOM node
    const domNode = this.#automergeIdToDom.get(nodeObjectId);
    if (!domNode) {
      return;
    }

    // Find the corresponding Automerge node in current doc
    const automergeNode = this.#findAutomergeNodeById(doc, nodeObjectId);
    if (!automergeNode) {
      return;
    }

    // Update DOM node to match current Automerge state
    this.#updateDOMNodeFromAutomerge(domNode, automergeNode);
  }

  /**
   * Create a DOM node from an Automerge node (single node, not recursive)
   */
  #createDOMNodeFromAutomerge(automergeNode: DOMJNode): Node {
    // Check if this Automerge node already has a DOM mapping
    const nodeId = getObjectId(automergeNode);
    if (nodeId) {
      const existingDomNode = this.#automergeIdToDom.get(nodeId);
      if (existingDomNode) {
        return existingDomNode;
      }
    }

    switch (automergeNode.nodeType) {
      case Node.ELEMENT_NODE: {
        const element = document.createElement(automergeNode.tagName);

        // Set attributes
        this.#setDOMAttributes(element, automergeNode.attributes);

        // Recursively create children
        for (const child of automergeNode.childNodes) {
          const childDomNode = this.#createDOMNodeFromAutomerge(child);
          element.appendChild(childDomNode);
        }

        return element;
      }
      case Node.TEXT_NODE: {
        return document.createTextNode(automergeNode.textContent);
      }
      case Node.COMMENT_NODE: {
        return document.createComment(automergeNode.textContent);
      }
      default: {
        automergeNode satisfies never;
        throw new Error(`Unsupported Automerge node type: ${(automergeNode as any).nodeType}`);
      }
    }
  }

  /**
   * Find the correct DOM insertion index based on Automerge insertion index
   */
  #findDOMInsertionIndex(automergeIndex: number, automergeChildren: DOMJNode[]): number {
    let domIndex = 0;

    // Count how many of the preceding Automerge children have corresponding DOM nodes
    for (let i = 0; i < automergeIndex && i < automergeChildren.length; i++) {
      const automergeChild = automergeChildren[i];
      const automergeChildId = getObjectId(automergeChild);

      if (automergeChildId && this.#automergeIdToDom.has(automergeChildId)) {
        domIndex++;
      }
    }

    return domIndex;
  }

  /**
   * Handle removed nodes in transaction
   */
  #handleRemovedNodesInTransaction(removedNodes: NodeList, parentAutomergeNode: DOMJElement): void {
    for (const removedNode of removedNodes) {
      // Find the corresponding Automerge node
      const removedNodeId = this.#domToAutomergeId.get(removedNode);
      if (!removedNodeId) {
        console.warn('Cannot find Automerge ID for removed DOM node:', removedNode);
        continue;
      }

      // Find the index of this node in the parent's childNodes array
      const nodeIndex = parentAutomergeNode.childNodes.findIndex((child) => {
        const childId = getObjectId(child);
        return childId === removedNodeId;
      });

      if (nodeIndex === -1) {
        console.warn('Cannot find removed node in parent childNodes array:', removedNodeId);
        continue;
      }

      // Remove from Automerge document
      parentAutomergeNode.childNodes.splice(nodeIndex, 1);

      // Clean up mappings for the removed subtree
      this.#cleanupMappingsForSubtree(removedNode);
    }
  }

  /**
   * Clean up mappings for a removed DOM subtree
   */
  #cleanupMappingsForSubtree(domNode: Node): void {
    // Remove mapping for this node
    const nodeId = this.#domToAutomergeId.get(domNode);
    if (nodeId) {
      this.#domToAutomergeId.delete(domNode);
      this.#automergeIdToDom.delete(nodeId);
    }

    // Recursively clean up children
    if (domNode.nodeType === Node.ELEMENT_NODE) {
      const element = domNode as Element;
      for (const child of element.childNodes) {
        this.#cleanupMappingsForSubtree(child);
      }
    }
  }

  /**
   * Handle deletion patches from Automerge
   */
  async #handleDeletePatch(patch: Patch, doc: DOMJElement): Promise<void> {
    // Delete patches are for childNodes arrays - check if this is a childNodes deletion
    if (!patch.path.includes('childNodes')) {
      console.warn('Delete patch not in childNodes, skipping:', patch);
      return;
    }

    // Get the parent node path (up to "childNodes")
    const parentPath = patch.path.slice(0, patch.path.lastIndexOf('childNodes') + 1);
    const parentObjectId = getIdFromPath(doc, parentPath.slice(0, -1)); // Remove 'childNodes'

    if (!parentObjectId) {
      console.warn('Cannot find parent object ID for delete patch:', patch);
      return;
    }

    // Find the corresponding DOM parent node
    const parentDomNode = this.#automergeIdToDom.get(parentObjectId);
    if (!parentDomNode || parentDomNode.nodeType !== Node.ELEMENT_NODE) {
      console.warn('Cannot find parent DOM element for delete patch:', patch);
      return;
    }

    const parentElement = parentDomNode as Element;

    // Find the corresponding Automerge parent node
    const parentAutomergeNode = this.#findAutomergeNodeById(doc, parentObjectId);
    if (!parentAutomergeNode || parentAutomergeNode.nodeType !== Node.ELEMENT_NODE) {
      console.warn('Cannot find parent Automerge node for delete patch:', patch);
      return;
    }

    // Instead of trying to match specific indices, find all DOM nodes that are mapped
    // but no longer exist in the current Automerge document (orphaned nodes)
    const currentAutomergeChildIds = new Set(
      parentAutomergeNode.childNodes.map((child) => getObjectId(child)).filter((id) => id !== null),
    );

    const domChildrenToRemove: Node[] = [];

    // Check all DOM children of this parent
    for (const domChild of Array.from(parentElement.childNodes)) {
      const domChildId = this.#domToAutomergeId.get(domChild);

      // If this DOM child has a mapping but is not in the current Automerge children,
      // it needs to be removed
      if (domChildId && !currentAutomergeChildIds.has(domChildId)) {
        domChildrenToRemove.push(domChild);
      }
    }

    // Remove all orphaned DOM nodes
    for (const domNodeToRemove of domChildrenToRemove) {
      parentElement.removeChild(domNodeToRemove);
      this.#cleanupMappingsForSubtree(domNodeToRemove);
    }
  }
}
